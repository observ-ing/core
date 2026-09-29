//! State-machine simulation of the ingester. The pattern it follows is
//! written up in `docs/system-tests.md`.
//!
//! Generates random traces of repo writes interleaved with adversarial Tap
//! delivery (cross-repo reordering, redelivery, cursor rewinds) and background
//! resolve-taxa passes, runs them through the real write path against a
//! scratch Postgres, then drains every queue and checks the database against
//! the reference model in [`model`]. On a violation it shrinks the trace to a
//! minimal reproduction. [`mutants`] checks the sim itself: every bug it has
//! found is re-injected, and the sim must still catch it.
//!
//! Opt-in, because it needs Postgres (with PostGIS) and creates a throwaway
//! database on it:
//!
//! ```sh
//! SIM_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
//!   cargo test -p tap-ingester sim -- --nocapture
//! ```
//!
//! Knobs: `SIM_CASES` (default 300), `SIM_STEPS` (default 40),
//! `SIM_BASE_SEED` (default 0; CI stays deterministic), `SIM_SEED` (replay one
//! seed).

mod driver;
mod model;
mod mutants;

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Debug;

use driver::{Driver, PgDriver};
use model::{Action, Effect, Snapshot, World};

/// Properties currently violated on main. Each is a real bug the sim found;
/// delete the entry in the PR that fixes it. The test fails on any violation
/// not listed here, and on a listed one that no longer reproduces, so the
/// list can't silently go stale.
const KNOWN_VIOLATIONS: &[&str] = &[
    // occurrences::upsert COALESCEs organism_quantity(_type)/external_records
    // on conflict, so an edit that removes them leaves the old values behind.
    // Fix: #856.
    "occurrences_match_repos",
    // identifications::upsert COALESCEs taxon_rank/kingdom on conflict, so an
    // edit that clears either field leaves the old value behind. Fix: #857.
    "identifications_match_repos",
    // Same upsert keeps a resolved accepted_taxon_key when the name changes,
    // and resolve-taxa only visits NULL keys, so the stale key is permanent.
    // Fix: #857.
    "accepted_taxon_key_matches_name",
    // Downstream of the kingdom COALESCE: identical names split into separate
    // (name, kingdom) vote groups in the community_ids matview. Fix: #857.
    "community_ids_match_model",
    // notifications has no uniqueness, so every redelivery (or edit) of an
    // identification/comment/like notifies the owner again. Fix: #858.
    "notifications_at_most_once",
    // likes::create is ON CONFLICT (subject_uri, did) DO NOTHING, so a second
    // like record for the same subject is dropped; deleting the first then
    // leaves the user "not liking" something their repo still likes.
    // Fix: #859.
    "likes_match_repos",
    // likes::create's ON CONFLICT targets (subject_uri, did), not the uri
    // primary key, so replaying an older version of a like errors (and lands
    // in failed_records) instead of being a no-op. Fix: #859.
    "ingest_succeeds",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Property {
    IngestSucceeds,
    Occurrences,
    Identifications,
    AcceptedTaxonKeys,
    Likes,
    CommunityIds,
    NotificationsAtMostOnce,
}

impl Property {
    const ALL: [Property; 7] = [
        Property::IngestSucceeds,
        Property::Occurrences,
        Property::Identifications,
        Property::AcceptedTaxonKeys,
        Property::Likes,
        Property::CommunityIds,
        Property::NotificationsAtMostOnce,
    ];

    fn name(self) -> &'static str {
        match self {
            Property::IngestSucceeds => "ingest_succeeds",
            Property::Occurrences => "occurrences_match_repos",
            Property::Identifications => "identifications_match_repos",
            Property::AcceptedTaxonKeys => "accepted_taxon_key_matches_name",
            Property::Likes => "likes_match_repos",
            Property::CommunityIds => "community_ids_match_model",
            Property::NotificationsAtMostOnce => "notifications_at_most_once",
        }
    }

    /// `Some(diff)` when the property is violated.
    fn check(self, expected: &Snapshot, actual: &Snapshot) -> Option<String> {
        match self {
            Property::IngestSucceeds => (!actual.ingest_errors.is_empty())
                .then(|| format!("    ingester rejected: {:?}", actual.ingest_errors)),
            Property::Occurrences => diff_maps(&expected.occurrences, &actual.occurrences),
            Property::Identifications => {
                diff_maps(&expected.identifications, &actual.identifications)
            }
            Property::AcceptedTaxonKeys => {
                diff_maps(&expected.accepted_taxon_keys, &actual.accepted_taxon_keys)
            }
            Property::Likes => diff_sets(&expected.likes, &actual.likes),
            Property::CommunityIds => diff_maps(&expected.community_ids, &actual.community_ids),
            Property::NotificationsAtMostOnce => {
                diff_maps(&BTreeMap::new(), &actual.duplicate_notifications)
            }
        }
    }
}

fn diff_sets<T: Ord + Debug>(expected: &BTreeSet<T>, actual: &BTreeSet<T>) -> Option<String> {
    let lines: Vec<_> = expected
        .difference(actual)
        .map(|v| format!("    missing from db: {v:?}"))
        .chain(
            actual
                .difference(expected)
                .map(|v| format!("    unexpected in db: {v:?}")),
        )
        .collect();
    (!lines.is_empty()).then(|| lines.join("\n"))
}

fn diff_maps<K: Ord + Debug, V: PartialEq + Debug>(
    expected: &BTreeMap<K, V>,
    actual: &BTreeMap<K, V>,
) -> Option<String> {
    let keys: BTreeSet<&K> = expected.keys().chain(actual.keys()).collect();
    let lines: Vec<_> = keys
        .into_iter()
        .filter_map(|k| match (expected.get(k), actual.get(k)) {
            (Some(e), Some(a)) if e == a => None,
            (Some(e), Some(a)) => {
                Some(format!("    {k:?}\n      model: {e:?}\n      db:    {a:?}"))
            }
            (Some(e), None) => Some(format!(
                "    {k:?}\n      model: {e:?}\n      db:    <missing>"
            )),
            (None, Some(a)) => Some(format!(
                "    {k:?}\n      model: <missing>\n      db:    {a:?}"
            )),
            (None, None) => None,
        })
        .collect();
    (!lines.is_empty()).then(|| lines.join("\n"))
}

/// Replay a trace from an empty system, drain every queue, run resolve-taxa,
/// and return (model, db).
async fn run(driver: &mut PgDriver, trace: &[Action]) -> (Snapshot, Snapshot) {
    driver.reset().await.expect("reset");
    let mut world = World::default();
    let mut errors = Vec::new();
    for action in trace {
        match world.step(action) {
            Effect::Ingest(events) => {
                for event in events {
                    errors.extend(driver.ingest(&event).await.err());
                }
            }
            Effect::ResolveTaxa => driver.resolve_taxa().await.expect("resolve-taxa"),
        }
    }
    for event in world.drain() {
        errors.extend(driver.ingest(&event).await.err());
    }
    driver.resolve_taxa().await.expect("resolve-taxa");
    let mut actual = driver.snapshot().await.expect("snapshot");
    actual.ingest_errors = errors;
    (world.expected(), actual)
}

async fn violates(driver: &mut PgDriver, trace: &[Action], property: Property) -> bool {
    let (expected, actual) = run(driver, trace).await;
    property.check(&expected, &actual).is_some()
}

/// Delta-debugging shrink: drop chunks of the trace (halving the chunk size
/// when nothing more can go) while the property still fails.
async fn shrink(driver: &mut PgDriver, mut trace: Vec<Action>, property: Property) -> Vec<Action> {
    let mut chunk = trace.len().div_ceil(2);
    while chunk > 0 {
        let mut progressed = false;
        let mut i = 0;
        while i < trace.len() {
            let mut candidate = trace[..i].to_vec();
            candidate.extend_from_slice(&trace[(i + chunk).min(trace.len())..]);
            if violates(driver, &candidate, property).await {
                trace = candidate;
                progressed = true;
            } else {
                i += chunk;
            }
        }
        if !progressed {
            chunk /= 2;
        }
    }
    trace
}

/// Fixed CI budget: seeds `0..DEFAULT_CASES`, `DEFAULT_STEPS` actions each.
const DEFAULT_CASES: u64 = 300;
const DEFAULT_STEPS: usize = 40;

/// A property violation, shrunk to its shortest reproduction.
struct Finding {
    seed: u64,
    trace: Vec<Action>,
    diff: String,
}

/// Run each seed's trace, shrinking the first violation of each property in
/// `targets`, until all of `targets` are found or the seeds run out.
async fn explore(
    driver: &mut PgDriver,
    seeds: &[u64],
    steps: usize,
    targets: &[Property],
) -> BTreeMap<Property, Finding> {
    let mut found = BTreeMap::new();
    for &seed in seeds {
        let trace = World::generate(seed, steps);
        let (expected, actual) = run(driver, &trace).await;
        for &property in targets {
            if found.contains_key(&property) || property.check(&expected, &actual).is_none() {
                continue;
            }
            let trace = shrink(driver, trace.clone(), property).await;
            let (expected, actual) = run(driver, &trace).await;
            let diff = property.check(&expected, &actual).unwrap_or_default();
            found.insert(property, Finding { seed, trace, diff });
        }
        if targets.iter().all(|p| found.contains_key(p)) {
            break;
        }
    }
    found
}

fn print_finding(property: Property, finding: &Finding) {
    eprintln!(
        "\n✗ {}  (seed {}, shrunk to {} steps)",
        property.name(),
        finding.seed,
        finding.trace.len()
    );
    for (i, action) in finding.trace.iter().enumerate() {
        eprintln!("    {:>2}. {action}", i + 1);
    }
    eprintln!("    -- then all queues drain and resolve-taxa runs --");
    eprintln!("{}", finding.diff);
}

/// A driver on a fresh scratch database, or `None` (and a note) when
/// `SIM_DATABASE_URL` isn't set, so plain `cargo test` skips DB-backed tests.
async fn scratch_driver() -> Option<PgDriver> {
    let Ok(server_url) = std::env::var("SIM_DATABASE_URL") else {
        eprintln!("skipping ingester sim: set SIM_DATABASE_URL to a Postgres server to run it");
        return None;
    };
    Some(
        PgDriver::create(&server_url)
            .await
            .expect("create scratch database"),
    )
}

fn env_num(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

#[tokio::test]
async fn ingester_converges_to_repo_state() {
    let Some(mut driver) = scratch_driver().await else {
        return;
    };
    let steps = env_num("SIM_STEPS", DEFAULT_STEPS as u64) as usize;
    let replay = std::env::var("SIM_SEED").ok().and_then(|s| s.parse().ok());
    let seeds: Vec<u64> = match replay {
        Some(seed) => vec![seed],
        None => {
            let base = env_num("SIM_BASE_SEED", 0);
            (base..base + env_num("SIM_CASES", DEFAULT_CASES)).collect()
        }
    };

    let found = explore(&mut driver, &seeds, steps, &Property::ALL).await;
    driver.destroy().await.expect("drop scratch database");

    eprintln!(
        "\ningester sim: {} trace(s) x {steps} steps, {} property violation(s)",
        seeds.len(),
        found.len()
    );
    for (&property, finding) in &found {
        print_finding(property, finding);
    }

    let found_names: BTreeSet<&str> = found.keys().map(|p| p.name()).collect();
    let known: BTreeSet<&str> = KNOWN_VIOLATIONS.iter().copied().collect();
    let new: Vec<_> = found_names.difference(&known).collect();
    assert!(
        new.is_empty(),
        "new property violations: {new:?} (details above)"
    );
    if replay.is_none() {
        let fixed: Vec<_> = known.difference(&found_names).collect();
        assert!(
            fixed.is_empty(),
            "{fixed:?} no longer reproduce; remove them from KNOWN_VIOLATIONS"
        );
    }
}
