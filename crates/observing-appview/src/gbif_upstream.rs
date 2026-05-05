// Wired into the request path in a follow-up branch; for now everything
// here is constructed only by the unit tests below.
#![allow(dead_code)]

//! [`TaxonomyUpstream`] implementation backed by the live GBIF v2 API.
//!
//! Maps a single `match_name` (or species lookup) response into the
//! `taxa`-row shape: one [`TaxonRow`] for the target taxon plus one row per
//! ancestor in the returned classification chain. Denormalized rank columns
//! on each ancestor row are filled in walking-down-the-classification, so a
//! family-rank ancestor carries the kingdom/phylum/class/order it sits
//! inside but no genus or species yet.
//!
//! The adapter does not (yet) follow synonym → accepted redirects; a synonym
//! match is persisted with `status = "SYNONYM"` and `accepted_taxon_key =
//! None`. Callers that need the accepted taxon should issue a follow-up
//! lookup once the V2 API surface is extended to expose `acceptedUsage`.

use chrono::Utc;
use gbif_api::{GbifClient as GbifApiClient, V2MatchResult, V2NameUsage};
use observing_db::taxa::TaxonRow;
use observing_db::taxonomy_resolver::{ResolveError, TaxonomyUpstream, UpstreamMatch};
use std::collections::HashMap;

/// Production [`TaxonomyUpstream`] over the raw GBIF v2 client.
pub struct GbifUpstream {
    api: GbifApiClient,
}

impl GbifUpstream {
    pub fn new(api: GbifApiClient) -> Self {
        Self { api }
    }
}

impl Default for GbifUpstream {
    fn default() -> Self {
        Self::new(GbifApiClient::new())
    }
}

impl TaxonomyUpstream for GbifUpstream {
    async fn match_name(
        &self,
        scientific_name: &str,
        kingdom_hint: Option<&str>,
    ) -> Result<Option<UpstreamMatch>, ResolveError> {
        let v2 = self
            .api
            .match_name(scientific_name, kingdom_hint)
            .await
            .map_err(|e| ResolveError::Upstream(e.to_string()))?;
        Ok(v2.and_then(build_upstream_match))
    }

    async fn get_by_key(&self, taxon_key: i64) -> Result<Option<UpstreamMatch>, ResolveError> {
        // GBIF's species-detail endpoint lacks the keyed classification chain
        // that `match_name` returns, so we'd need follow-up calls per ancestor
        // to construct anything resolver-shaped. Until that's wired up,
        // by-key lookups always miss the upstream — callers will fall back
        // to whatever's cached. This is fine for now: by-key lookups today
        // come from `accepted_taxon_key` chases on synonym rows we haven't
        // finished plumbing.
        let _ = taxon_key;
        Ok(None)
    }
}

/// Build an [`UpstreamMatch`] from a GBIF v2 match result. Returns `None`
/// when the match has no usable target (no `usage`, or no integer key).
fn build_upstream_match(v2: V2MatchResult) -> Option<UpstreamMatch> {
    let usage = v2.usage.as_ref()?;
    let target_key = usage.key.map(|k| k as i64)?;
    let classification = v2.classification.as_deref().unwrap_or(&[]);

    // accumulated[rank] = (name, key) for every rank seen so far in the
    // classification chain. Used to fill in each row's denormalized
    // ancestor columns.
    let mut accumulated: HashMap<String, (String, Option<i64>)> = HashMap::new();
    let mut rows: Vec<TaxonRow> = Vec::with_capacity(classification.len() + 1);
    let mut parent_key: Option<i64> = None;

    for ancestor in classification {
        let Some(row) = ancestor_row(ancestor, &mut accumulated, parent_key) else {
            continue;
        };
        parent_key = Some(row.taxon_key);
        rows.push(row);
    }

    rows.push(target_row(
        usage,
        &accumulated,
        parent_key,
        v2.synonym,
        target_key,
    ));

    Some(UpstreamMatch { target_key, rows })
}

/// Build a [`TaxonRow`] for one classification ancestor, also recording its
/// (rank, name, key) into `accumulated` so subsequent rows can pick it up.
/// Returns `None` if the ancestor lacks a usable name or key.
fn ancestor_row(
    ancestor: &V2NameUsage,
    accumulated: &mut HashMap<String, (String, Option<i64>)>,
    parent_key: Option<i64>,
) -> Option<TaxonRow> {
    let rank = ancestor.rank.as_deref()?.to_lowercase();
    let key = ancestor.key.map(|k| k as i64)?;
    let name = ancestor
        .canonical_name
        .clone()
        .or_else(|| ancestor.name.clone())?;

    accumulated.insert(rank.clone(), (name.clone(), Some(key)));

    Some(row_with_classification(
        key,
        &name,
        &rank,
        "ACCEPTED",
        Some(key),
        parent_key,
        accumulated,
    ))
}

/// Build the [`TaxonRow`] for the target taxon (the `usage` of the match).
fn target_row(
    usage: &V2NameUsage,
    accumulated: &HashMap<String, (String, Option<i64>)>,
    parent_key: Option<i64>,
    synonym: bool,
    target_key: i64,
) -> TaxonRow {
    let name = usage
        .canonical_name
        .clone()
        .or_else(|| usage.name.clone())
        .unwrap_or_default();
    let rank = usage
        .rank
        .as_deref()
        .map(|r| r.to_lowercase())
        .unwrap_or_else(|| "unknown".to_string());

    let (status, accepted_taxon_key) = if synonym {
        // V2 doesn't expose acceptedUsage in our current client surface;
        // leave the accepted pointer NULL and rely on a future follow-up.
        ("SYNONYM", None)
    } else {
        ("ACCEPTED", Some(target_key))
    };

    row_with_classification(
        target_key,
        &name,
        &rank,
        status,
        accepted_taxon_key,
        parent_key,
        accumulated,
    )
}

fn row_with_classification(
    taxon_key: i64,
    scientific_name: &str,
    rank: &str,
    status: &str,
    accepted_taxon_key: Option<i64>,
    parent_key: Option<i64>,
    accumulated: &HashMap<String, (String, Option<i64>)>,
) -> TaxonRow {
    let pick = |r: &str| -> (Option<String>, Option<i64>) {
        accumulated
            .get(r)
            .map(|(n, k)| (Some(n.clone()), *k))
            .unwrap_or((None, None))
    };
    let (kingdom, kingdom_key) = pick("kingdom");
    let (phylum, phylum_key) = pick("phylum");
    let (class, class_key) = pick("class");
    let (order_, order_key) = pick("order");
    let (family, family_key) = pick("family");
    let (genus, genus_key) = pick("genus");
    let (species, species_key) = pick("species");

    TaxonRow {
        taxon_key,
        scientific_name: scientific_name.to_string(),
        authorship: None,
        rank: rank.to_string(),
        status: status.to_string(),
        accepted_taxon_key,
        parent_key,
        kingdom,
        kingdom_key,
        phylum,
        phylum_key,
        class,
        class_key,
        order_,
        order_key,
        family,
        family_key,
        genus,
        genus_key,
        species,
        species_key,
        vernacular_name: None,
        extinct: None,
        fetched_at: Utc::now(),
        source: "gbif".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gbif_api::V2NameUsage;

    fn usage(key: u64, name: &str, rank: &str) -> V2NameUsage {
        V2NameUsage {
            key: Some(key),
            name: Some(name.to_string()),
            canonical_name: Some(name.to_string()),
            rank: Some(rank.to_string()),
            kingdom: None,
            phylum: None,
            class: None,
            order: None,
            family: None,
            genus: None,
            species: None,
        }
    }

    #[test]
    fn species_match_produces_rows_for_each_ancestor_plus_target() {
        let v2 = V2MatchResult {
            synonym: false,
            usage: Some(usage(1, "Quercus alba", "species")),
            classification: Some(vec![
                usage(10, "Plantae", "kingdom"),
                usage(20, "Tracheophyta", "phylum"),
                usage(30, "Magnoliopsida", "class"),
                usage(40, "Fagales", "order"),
                usage(50, "Fagaceae", "family"),
                usage(60, "Quercus", "genus"),
            ]),
            additional_status: None,
            diagnostics: None,
        };

        let m = build_upstream_match(v2).expect("usage with key produces a match");
        assert_eq!(m.target_key, 1);
        assert_eq!(m.rows.len(), 7); // 6 ancestors + target

        let target = m.rows.iter().find(|r| r.taxon_key == 1).unwrap();
        assert_eq!(target.scientific_name, "Quercus alba");
        assert_eq!(target.rank, "species");
        assert_eq!(target.status, "ACCEPTED");
        assert_eq!(target.kingdom.as_deref(), Some("Plantae"));
        assert_eq!(target.kingdom_key, Some(10));
        assert_eq!(target.family.as_deref(), Some("Fagaceae"));
        assert_eq!(target.genus.as_deref(), Some("Quercus"));
        assert_eq!(target.parent_key, Some(60));
    }

    #[test]
    fn ancestor_rows_carry_only_higher_ranks() {
        let v2 = V2MatchResult {
            synonym: false,
            usage: Some(usage(1, "Quercus alba", "species")),
            classification: Some(vec![
                usage(10, "Plantae", "kingdom"),
                usage(50, "Fagaceae", "family"),
            ]),
            additional_status: None,
            diagnostics: None,
        };

        let m = build_upstream_match(v2).unwrap();
        let plantae = m.rows.iter().find(|r| r.taxon_key == 10).unwrap();
        assert_eq!(plantae.rank, "kingdom");
        assert_eq!(plantae.kingdom.as_deref(), Some("Plantae"));
        assert!(plantae.family.is_none()); // no family below kingdom
        assert!(plantae.parent_key.is_none()); // root of the chain

        let fagaceae = m.rows.iter().find(|r| r.taxon_key == 50).unwrap();
        assert_eq!(fagaceae.rank, "family");
        assert_eq!(fagaceae.kingdom.as_deref(), Some("Plantae"));
        assert_eq!(fagaceae.family.as_deref(), Some("Fagaceae"));
        assert!(fagaceae.genus.is_none());
        assert_eq!(fagaceae.parent_key, Some(10));
    }

    #[test]
    fn synonym_target_marked_synonym_with_no_accepted_pointer() {
        let v2 = V2MatchResult {
            synonym: true,
            usage: Some(usage(2, "Quercus pedunculata", "species")),
            classification: Some(vec![usage(10, "Plantae", "kingdom")]),
            additional_status: None,
            diagnostics: None,
        };

        let m = build_upstream_match(v2).unwrap();
        let target = m.rows.iter().find(|r| r.taxon_key == 2).unwrap();
        assert_eq!(target.status, "SYNONYM");
        assert!(target.accepted_taxon_key.is_none());
    }

    #[test]
    fn missing_target_key_yields_no_match() {
        let mut u = usage(0, "Foo", "species");
        u.key = None;
        let v2 = V2MatchResult {
            synonym: false,
            usage: Some(u),
            classification: None,
            additional_status: None,
            diagnostics: None,
        };
        assert!(build_upstream_match(v2).is_none());
    }

    #[test]
    fn ancestors_without_keys_are_skipped() {
        let mut nameless = usage(0, "Mystery", "phylum");
        nameless.key = None;
        let v2 = V2MatchResult {
            synonym: false,
            usage: Some(usage(1, "Quercus alba", "species")),
            classification: Some(vec![usage(10, "Plantae", "kingdom"), nameless]),
            additional_status: None,
            diagnostics: None,
        };

        let m = build_upstream_match(v2).unwrap();
        // Plantae + target only; the keyless phylum is skipped.
        assert_eq!(m.rows.len(), 2);
        let target = m.rows.iter().find(|r| r.taxon_key == 1).unwrap();
        assert!(target.phylum.is_none());
    }
}
