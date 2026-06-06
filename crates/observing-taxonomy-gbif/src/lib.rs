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
//! None`. The generated client now exposes `accepted_usage` on the v2 match
//! response, so wiring this up is a follow-up.

use chrono::Utc;
use gbif::checklistbank::{
    types::{NameUsageMatch, RankedName, Usage},
    Client as GbifClient,
};
use observing_db::taxa::TaxonRow;
use observing_db::taxonomy_resolver::{ResolveError, TaxonomyUpstream, UpstreamMatch};
use std::collections::HashMap;

const GBIF_BASE_URL: &str = "https://api.gbif.org";

/// Production [`TaxonomyUpstream`] over the generated GBIF v2 client.
pub struct GbifUpstream {
    api: GbifClient,
}

impl GbifUpstream {
    pub fn new() -> Self {
        Self {
            api: GbifClient::new(GBIF_BASE_URL),
        }
    }
}

impl Default for GbifUpstream {
    fn default() -> Self {
        Self::new()
    }
}

impl TaxonomyUpstream for GbifUpstream {
    async fn match_name(
        &self,
        scientific_name: &str,
        kingdom_hint: Option<&str>,
    ) -> Result<Option<UpstreamMatch>, ResolveError> {
        // Order matches the generated 26-arg signature; everything except
        // kingdom + scientific_name is None.
        let result = self
            .api
            .match_names(
                None,                  //  1 class
                None,                  //  2 exclude
                None,                  //  3 family
                None,                  //  4 generic_name
                None,                  //  5 genus
                None,                  //  6 infraspecific_epithet
                kingdom_hint,          //  7 kingdom
                None,                  //  8 order
                None,                  //  9 phylum
                Some(scientific_name), // 10 scientific_name
                None,                  // 11 scientific_name_authorship
                None,                  // 12 scientific_name_id
                None,                  // 13 species
                None,                  // 14 specific_epithet
                None,                  // 15 strict
                None,                  // 16 subfamily
                None,                  // 17 subgenus
                None,                  // 18 subtribe
                None,                  // 19 superfamily
                None,                  // 20 taxon_concept_id
                None,                  // 21 taxon_id
                None,                  // 22 taxon_rank
                None,                  // 23 tribe
                None,                  // 24 usage_key
                None,                  // 25 verbatim_taxon_rank
                None,                  // 26 verbose
            )
            .await;

        let m: NameUsageMatch = match result {
            Ok(rv) => rv.into_inner(),
            Err(e) if e.status() == Some(reqwest::StatusCode::NOT_FOUND) => return Ok(None),
            Err(e) => return Err(ResolveError::Upstream(e.to_string())),
        };

        Ok(build_upstream_match(m))
    }

    async fn get_by_key(&self, taxon_key: i64) -> Result<Option<UpstreamMatch>, ResolveError> {
        // The v2 `/species/match` endpoint accepts a `usageKey` and returns the
        // same `NameUsageMatch` (usage + classification chain) as a name match,
        // so a by-key lookup reuses the exact response shape `match_name` does.
        let usage_key = taxon_key.to_string();
        let result = self
            .api
            .match_names(
                None,             //  1 class
                None,             //  2 exclude
                None,             //  3 family
                None,             //  4 generic_name
                None,             //  5 genus
                None,             //  6 infraspecific_epithet
                None,             //  7 kingdom
                None,             //  8 order
                None,             //  9 phylum
                None,             // 10 scientific_name
                None,             // 11 scientific_name_authorship
                None,             // 12 scientific_name_id
                None,             // 13 species
                None,             // 14 specific_epithet
                None,             // 15 strict
                None,             // 16 subfamily
                None,             // 17 subgenus
                None,             // 18 subtribe
                None,             // 19 superfamily
                None,             // 20 taxon_concept_id
                None,             // 21 taxon_id
                None,             // 22 taxon_rank
                None,             // 23 tribe
                Some(&usage_key), // 24 usage_key
                None,             // 25 verbatim_taxon_rank
                None,             // 26 verbose
            )
            .await;

        let m: NameUsageMatch = match result {
            Ok(rv) => rv.into_inner(),
            Err(e) if e.status() == Some(reqwest::StatusCode::NOT_FOUND) => return Ok(None),
            Err(e) => return Err(ResolveError::Upstream(e.to_string())),
        };

        Ok(build_upstream_match(m))
    }
}

/// Serialize an enum (Usage rank, RankedName rank, …) to its on-the-wire
/// string. Returns `None` for non-string serializations.
fn rank_to_string<R: serde::Serialize>(rank: &R) -> Option<String> {
    serde_json::to_value(rank)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
}

/// Build an [`UpstreamMatch`] from a GBIF v2 match result. Returns `None`
/// when the match has no usable target (no `usage`, or no integer key).
fn build_upstream_match(m: NameUsageMatch) -> Option<UpstreamMatch> {
    let usage = m.usage.as_ref()?;
    let target_key = usage.key.as_deref()?.parse::<i64>().ok()?;
    let synonym = m.synonym.unwrap_or(false);

    // accumulated[rank] = (name, key) for every rank seen so far in the
    // classification chain. Used to fill in each row's denormalized
    // ancestor columns.
    let mut accumulated: HashMap<String, (String, Option<i64>)> = HashMap::new();
    let mut rows: Vec<TaxonRow> = Vec::with_capacity(m.classification.len() + 1);
    let mut parent_key: Option<i64> = None;

    for ancestor in &m.classification {
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
        synonym,
        target_key,
    ));

    Some(UpstreamMatch { target_key, rows })
}

/// Build a [`TaxonRow`] for one classification ancestor, also recording its
/// (rank, name, key) into `accumulated` so subsequent rows can pick it up.
/// Returns `None` if the ancestor lacks a usable name, key, or rank.
fn ancestor_row(
    ancestor: &RankedName,
    accumulated: &mut HashMap<String, (String, Option<i64>)>,
    parent_key: Option<i64>,
) -> Option<TaxonRow> {
    let rank = ancestor
        .rank
        .as_ref()
        .and_then(rank_to_string)?
        .to_lowercase();
    let key = ancestor.key.as_deref()?.parse::<i64>().ok()?;
    let name = ancestor.name.clone()?;

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
    usage: &Usage,
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
        .as_ref()
        .and_then(rank_to_string)
        .map(|r| r.to_lowercase())
        .unwrap_or_else(|| "unknown".to_string());

    let (status, accepted_taxon_key) = if synonym {
        // V2 does expose acceptedUsage now, but plumbing it through is a
        // follow-up; leave the accepted pointer NULL for the time being.
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
    use serde_json::json;

    /// Build a `NameUsageMatch` from a JSON literal. Several v2 fields
    /// (classification, additional_status) are non-Option `Vec` without
    /// `serde(default)` quirks here, but going through JSON keeps the
    /// fixtures readable when we only set a handful of fields.
    fn match_from_json(value: serde_json::Value) -> NameUsageMatch {
        serde_json::from_value(value).expect("test fixture is a valid NameUsageMatch")
    }

    #[test]
    fn species_match_produces_rows_for_each_ancestor_plus_target() {
        let m = match_from_json(json!({
            "synonym": false,
            "usage": { "key": "1", "name": "Quercus alba", "canonicalName": "Quercus alba", "rank": "SPECIES" },
            "classification": [
                { "key": "10", "name": "Plantae",       "rank": "KINGDOM" },
                { "key": "20", "name": "Tracheophyta",  "rank": "PHYLUM" },
                { "key": "30", "name": "Magnoliopsida", "rank": "CLASS" },
                { "key": "40", "name": "Fagales",       "rank": "ORDER" },
                { "key": "50", "name": "Fagaceae",      "rank": "FAMILY" },
                { "key": "60", "name": "Quercus",       "rank": "GENUS" },
            ]
        }));

        let upstream = build_upstream_match(m).expect("usage with key produces a match");
        assert_eq!(upstream.target_key, 1);
        assert_eq!(upstream.rows.len(), 7); // 6 ancestors + target

        let target = upstream.rows.iter().find(|r| r.taxon_key == 1).unwrap();
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
        let m = match_from_json(json!({
            "synonym": false,
            "usage": { "key": "1", "name": "Quercus alba", "canonicalName": "Quercus alba", "rank": "SPECIES" },
            "classification": [
                { "key": "10", "name": "Plantae",  "rank": "KINGDOM" },
                { "key": "50", "name": "Fagaceae", "rank": "FAMILY" },
            ]
        }));

        let upstream = build_upstream_match(m).unwrap();
        let plantae = upstream.rows.iter().find(|r| r.taxon_key == 10).unwrap();
        assert_eq!(plantae.rank, "kingdom");
        assert_eq!(plantae.kingdom.as_deref(), Some("Plantae"));
        assert!(plantae.family.is_none()); // no family below kingdom
        assert!(plantae.parent_key.is_none()); // root of the chain

        let fagaceae = upstream.rows.iter().find(|r| r.taxon_key == 50).unwrap();
        assert_eq!(fagaceae.rank, "family");
        assert_eq!(fagaceae.kingdom.as_deref(), Some("Plantae"));
        assert_eq!(fagaceae.family.as_deref(), Some("Fagaceae"));
        assert!(fagaceae.genus.is_none());
        assert_eq!(fagaceae.parent_key, Some(10));
    }

    #[test]
    fn synonym_target_marked_synonym_with_no_accepted_pointer() {
        let m = match_from_json(json!({
            "synonym": true,
            "usage": { "key": "2", "name": "Quercus pedunculata", "canonicalName": "Quercus pedunculata", "rank": "SPECIES" },
            "classification": [
                { "key": "10", "name": "Plantae", "rank": "KINGDOM" },
            ]
        }));

        let upstream = build_upstream_match(m).unwrap();
        let target = upstream.rows.iter().find(|r| r.taxon_key == 2).unwrap();
        assert_eq!(target.status, "SYNONYM");
        assert!(target.accepted_taxon_key.is_none());
    }

    #[test]
    fn missing_target_key_yields_no_match() {
        let m = match_from_json(json!({
            "synonym": false,
            "usage": { "name": "Foo", "canonicalName": "Foo", "rank": "SPECIES" }
        }));
        assert!(build_upstream_match(m).is_none());
    }

    #[test]
    fn ancestors_without_keys_are_skipped() {
        let m = match_from_json(json!({
            "synonym": false,
            "usage": { "key": "1", "name": "Quercus alba", "canonicalName": "Quercus alba", "rank": "SPECIES" },
            "classification": [
                { "key": "10", "name": "Plantae", "rank": "KINGDOM" },
                {              "name": "Mystery", "rank": "PHYLUM"  },
            ]
        }));

        let upstream = build_upstream_match(m).unwrap();
        // Plantae + target only; the keyless phylum is skipped.
        assert_eq!(upstream.rows.len(), 2);
        let target = upstream.rows.iter().find(|r| r.taxon_key == 1).unwrap();
        assert!(target.phylum.is_none());
    }
}
