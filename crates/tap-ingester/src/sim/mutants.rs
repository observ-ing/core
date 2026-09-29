//! Mutation tests for the sim itself.
//!
//! The known-bugs ratchet proves fixed bugs stay fixed, but it can't tell
//! "fixed" from "the sim can no longer see it". A generator change that makes
//! edits rare, a property that compares empty to empty, or a broken shrinker
//! would all leave CI green. So each bug the sim has found (plus a synthetic
//! one or two) lives on here as a *mutant*: a Postgres trigger or constraint,
//! installed on the scratch database, that reintroduces the bug without
//! touching production code. The test fails unless the sim catches every
//! mutant with the expected properties, in a readable number of steps.
//!
//! Every mutant installs on the schema both before and after its fix, so the
//! list can hold a bug's mutant while the bug is still live (it's caught
//! trivially then; the output says so) and starts proving something the
//! moment the fix lands.
//!
//! When the sim finds a new bug: add its property to KNOWN_VIOLATIONS and its
//! mutant here, then fix it.

use super::driver::Driver;
use super::{
    explore, print_finding, scratch_driver, Property, DEFAULT_CASES, DEFAULT_STEPS,
    KNOWN_VIOLATIONS,
};

/// A shrunk reproduction longer than this means shrinking has regressed.
const MAX_SHRUNK_STEPS: usize = 10;

struct Mutant {
    name: &'static str,
    /// Properties that must catch it.
    catches: &'static [Property],
    install: &'static str,
    uninstall: &'static str,
}

/// Trigger-based mutants all use this function name, so one uninstall fits.
const DROP_TRIGGER_MUTANT: &str = "DROP FUNCTION sim_mutant() CASCADE";

const MUTANTS: &[Mutant] = &[
    Mutant {
        // The occurrence upsert used to COALESCE these, so edits couldn't
        // remove them (e.g. external records removed in the edit form).
        name: "occurrence_edit_keeps_removed_fields",
        catches: &[Property::Occurrences],
        install: "
            CREATE FUNCTION sim_mutant() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                NEW.organism_quantity := COALESCE(NEW.organism_quantity, OLD.organism_quantity);
                NEW.organism_quantity_type :=
                    COALESCE(NEW.organism_quantity_type, OLD.organism_quantity_type);
                NEW.external_records := COALESCE(NEW.external_records, OLD.external_records);
                RETURN NEW;
            END $$;
            CREATE TRIGGER sim_mutant BEFORE UPDATE ON occurrences
                FOR EACH ROW EXECUTE FUNCTION sim_mutant();
        ",
        uninstall: DROP_TRIGGER_MUTANT,
    },
    Mutant {
        // The identification upsert used to COALESCE these, so edits couldn't
        // clear them, and a stale kingdom split community_ids votes.
        name: "identification_edit_keeps_cleared_fields",
        catches: &[Property::Identifications, Property::CommunityIds],
        install: "
            CREATE FUNCTION sim_mutant() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                NEW.taxon_rank := COALESCE(NEW.taxon_rank, OLD.taxon_rank);
                NEW.kingdom := COALESCE(NEW.kingdom, OLD.kingdom);
                RETURN NEW;
            END $$;
            CREATE TRIGGER sim_mutant BEFORE UPDATE ON identifications
                FOR EACH ROW EXECUTE FUNCTION sim_mutant();
        ",
        uninstall: DROP_TRIGGER_MUTANT,
    },
    Mutant {
        // A rename used to keep the old taxon's key, which resolve-taxa (NULL
        // keys only) never revisits.
        name: "rename_keeps_stale_taxon_key",
        catches: &[Property::AcceptedTaxonKeys],
        install: "
            CREATE FUNCTION sim_mutant() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                NEW.accepted_taxon_key :=
                    COALESCE(NEW.accepted_taxon_key, OLD.accepted_taxon_key);
                RETURN NEW;
            END $$;
            CREATE TRIGGER sim_mutant BEFORE UPDATE ON identifications
                FOR EACH ROW EXECUTE FUNCTION sim_mutant();
        ",
        uninstall: DROP_TRIGGER_MUTANT,
    },
    Mutant {
        // Without the unique index, ON CONFLICT DO NOTHING never fires and a
        // redelivered record notifies again. The index only exists once its
        // fix has landed, so remember whether there was one to put back.
        name: "redelivery_renotifies",
        catches: &[Property::NotificationsAtMostOnce],
        install: "
            CREATE TABLE sim_mutant_state AS SELECT
                to_regclass('ingester.notifications_once_per_reference_idx') IS NOT NULL
                    AS had_index;
            DROP INDEX IF EXISTS ingester.notifications_once_per_reference_idx;
        ",
        uninstall: "
            DO $$ BEGIN
                IF (SELECT had_index FROM sim_mutant_state) THEN
                    CREATE UNIQUE INDEX notifications_once_per_reference_idx
                        ON ingester.notifications (recipient_did, actor_did, kind, reference_uri);
                END IF;
            END $$;
            DROP TABLE sim_mutant_state;
        ",
    },
    Mutant {
        // The old one-like-per-user constraint: a second like record is
        // rejected, so unliking the first leaves the DB out of step with the
        // repo. (Before its fix this duplicates the existing constraint.)
        name: "second_like_rejected",
        catches: &[Property::Likes, Property::IngestSucceeds],
        install: "
            ALTER TABLE likes ADD CONSTRAINT sim_mutant_one_like_per_user
                UNIQUE (subject_uri, did)
        ",
        uninstall: "ALTER TABLE likes DROP CONSTRAINT sim_mutant_one_like_per_user",
    },
    Mutant {
        // Synthetic: occurrence deletes silently do nothing.
        name: "occurrence_deletes_ignored",
        catches: &[Property::Occurrences],
        install: "
            CREATE FUNCTION sim_mutant() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                RETURN NULL;
            END $$;
            CREATE TRIGGER sim_mutant BEFORE DELETE ON occurrences
                FOR EACH ROW EXECUTE FUNCTION sim_mutant();
        ",
        uninstall: DROP_TRIGGER_MUTANT,
    },
];

/// A property no mutant exercises could be vacuous and nobody would know.
#[test]
fn every_property_has_a_mutant() {
    for property in Property::ALL {
        assert!(
            MUTANTS.iter().any(|m| m.catches.contains(&property)),
            "no mutant exercises {}; add one to MUTANTS",
            property.name()
        );
    }
}

#[tokio::test]
async fn sim_catches_every_mutant() {
    let Some(mut driver) = scratch_driver().await else {
        return;
    };
    let seeds: Vec<u64> = (0..DEFAULT_CASES).collect();
    // A clean system after each uninstall, so a leftover mutant can't make a
    // later one look caught.
    let clean_check: Vec<u64> = (0..20).collect();
    let mut problems = Vec::new();

    for mutant in MUTANTS {
        driver.reset().await.expect("reset");
        driver.execute(mutant.install).await.expect(mutant.name);
        let found = explore(&mut driver, &seeds, DEFAULT_STEPS, mutant.catches).await;
        driver.reset().await.expect("reset");
        driver.execute(mutant.uninstall).await.expect(mutant.name);

        for property in mutant.catches {
            let live = KNOWN_VIOLATIONS.contains(&property.name());
            match found.get(property) {
                Some(finding) => {
                    eprintln!(
                        "✓ {:<42} caught by {:<32} seed {:>3}, {} steps{}",
                        mutant.name,
                        property.name(),
                        finding.seed,
                        finding.trace.len(),
                        if live {
                            "  (property already failing here: proves nothing until fixed)"
                        } else {
                            ""
                        }
                    );
                    if finding.trace.len() > MAX_SHRUNK_STEPS {
                        print_finding(*property, finding);
                        problems.push(format!(
                            "{} / {}: shrunk only to {} steps (max {MAX_SHRUNK_STEPS})",
                            mutant.name,
                            property.name(),
                            finding.trace.len()
                        ));
                    }
                }
                None => {
                    eprintln!("✗ {:<42} MISSED by {}", mutant.name, property.name());
                    problems.push(format!(
                        "{} not caught by {} in {DEFAULT_CASES} traces",
                        mutant.name,
                        property.name()
                    ));
                }
            }
        }

        let unknown: Vec<Property> = Property::ALL
            .into_iter()
            .filter(|p| !KNOWN_VIOLATIONS.contains(&p.name()))
            .collect();
        let leftovers = explore(&mut driver, &clean_check, DEFAULT_STEPS, &unknown).await;
        if !leftovers.is_empty() {
            problems.push(format!(
                "{}: violations remain after uninstall: {:?}",
                mutant.name,
                leftovers.keys().map(|p| p.name()).collect::<Vec<_>>()
            ));
        }
    }
    driver.destroy().await.expect("drop scratch database");

    assert!(
        problems.is_empty(),
        "the sim has lost the ability to find bugs:\n  {}",
        problems.join("\n  ")
    );
}
