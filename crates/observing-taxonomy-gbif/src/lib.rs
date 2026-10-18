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
//!
//! Key lookups that v2 can't answer fall back to the v1 name usage, whose
//! denormalized kingdom…species keys stand in for the classification chain.

use chrono::Utc;
use gbif::checklistbank::{
    types::{
        DiagnosticsMatchType, NameUsage, NameUsageMatch, NameUsageTaxonomicStatus, RankedName,
        Usage,
    },
    Client as GbifClient,
};
use gbif::Uuid;
use observing_db::taxa::TaxonRow;
use observing_db::taxonomy_resolver::{ResolveError, TaxonomyUpstream, UpstreamMatch};
use std::collections::HashMap;

const GBIF_BASE_URL: &str = "https://api.gbif.org";

/// Dataset key of the GBIF Backbone Taxonomy, the checklist `taxa` caches.
const GBIF_BACKBONE_DATASET_KEY: Uuid = Uuid::from_u128(0xd7dddbf4_2cf0_4f39_9b2a_bb099caae36c);

/// Production [`TaxonomyUpstream`] over the generated GBIF v2 client.
pub struct GbifUpstream {
    api: GbifClient,
}

impl GbifUpstream {
    pub fn new() -> Self {
        Self::with_base_url(GBIF_BASE_URL)
    }

    /// Construct an upstream pointed at an arbitrary base URL. Production
    /// uses the GBIF host; tests point it at a wiremock server.
    pub fn with_base_url(base_url: &str) -> Self {
        Self {
            api: GbifClient::new(base_url),
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

        // Keying an identification to the ancestor GBIF fell back to would
        // file it under the wrong taxon, so report no match instead; the
        // resolver's taxonID phase can still key it from the record's URI.
        if is_higher_rank_fallback(&m, scientific_name) {
            return Ok(None);
        }

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

        let v2 = match result {
            Ok(rv) => build_upstream_match(rv.into_inner()),
            Err(e) if e.status() == Some(reqwest::StatusCode::NOT_FOUND) => None,
            Err(e) => return Err(ResolveError::Upstream(e.to_string())),
        };
        if v2.is_some() {
            return Ok(v2);
        }

        // v2 only matches usages in the current backbone release, and answers
        // any other key with matchType NONE. Wikidata still points iNaturalist
        // taxa at keys GBIF has since deleted (1875 Papilionoidea went when the
        // 2016 backbone dropped superfamilies; 1934362 Apodemia mormo in 2022),
        // and v1 `/species/{key}` still serves those, so ask it instead.
        let Ok(v1_key) = i32::try_from(taxon_key) else {
            return Ok(None);
        };
        match self.api.get_name_usage(v1_key, None).await {
            Ok(rv) => Ok(build_upstream_match_from_usage(&rv.into_inner())),
            Err(e) if e.status() == Some(reqwest::StatusCode::NOT_FOUND) => Ok(None),
            Err(e) => Err(ResolveError::Upstream(e.to_string())),
        }
    }
}

/// Serialize an enum (Usage rank, RankedName rank, …) to its on-the-wire
/// string. Returns `None` for non-string serializations.
fn rank_to_string<R: serde::Serialize>(rank: &R) -> Option<String> {
    serde_json::to_value(rank)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
}

/// Whether GBIF answered a name match with an ancestor instead of the name.
/// GBIF does this when it can't choose between homonyms (e.g. "Anisoptera"
/// → Insecta, "Sciurus" → Chordata): a HIGHERRANK match whose usage is the
/// closest rank the candidates share.
fn is_higher_rank_fallback(m: &NameUsageMatch, scientific_name: &str) -> bool {
    let higher_rank = m.diagnostics.as_ref().and_then(|d| d.match_type.as_ref())
        == Some(&DiagnosticsMatchType::Higherrank);
    let canonical = m
        .usage
        .as_ref()
        .and_then(|u| u.canonical_name.as_deref())
        .unwrap_or("");
    higher_rank && !canonical.eq_ignore_ascii_case(scientific_name)
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

/// Build an [`UpstreamMatch`] from a v1 name usage. v1 has no classification
/// chain, so the ancestors come from its denormalized kingdom…species
/// names and keys. Returns `None` for usages outside the backbone, whose
/// keys (and ancestor keys) belong to another checklist.
fn build_upstream_match_from_usage(usage: &NameUsage) -> Option<UpstreamMatch> {
    if usage.dataset_key != GBIF_BACKBONE_DATASET_KEY {
        return None;
    }
    let target_key = i64::from(usage.key);
    let chain = [
        ("kingdom", &usage.kingdom, usage.kingdom_key),
        ("phylum", &usage.phylum, usage.phylum_key),
        ("class", &usage.class, usage.class_key),
        ("order", &usage.order, usage.order_key),
        ("family", &usage.family, usage.family_key),
        ("genus", &usage.genus, usage.genus_key),
        ("species", &usage.species, usage.species_key),
    ];

    let mut accumulated: HashMap<String, (String, Option<i64>)> = HashMap::new();
    let mut rows: Vec<TaxonRow> = Vec::with_capacity(chain.len() + 1);
    let mut parent_key: Option<i64> = None;

    for (rank, name, key) in chain {
        let (Some(name), Some(key)) = (name, key) else {
            continue;
        };
        let key = i64::from(key);
        accumulated.insert(rank.to_string(), (name.clone(), Some(key)));
        // A species or genus usage lists itself at its own rank: that fills
        // the target's own column but isn't an ancestor.
        if key == target_key {
            continue;
        }
        rows.push(row_with_classification(
            key,
            name,
            rank,
            "ACCEPTED",
            Some(key),
            parent_key,
            &accumulated,
        ));
        parent_key = Some(key);
    }

    let name = usage
        .canonical_name
        .as_deref()
        .unwrap_or(&usage.scientific_name);
    let rank = usage
        .rank
        .as_ref()
        .and_then(rank_to_string)
        .map(|r| r.to_lowercase())
        .unwrap_or_else(|| "unknown".to_string());
    let accepted_key = usage.accepted_key.map(i64::from);
    let (status, accepted_taxon_key) = match usage.taxonomic_status {
        Some(
            NameUsageTaxonomicStatus::Synonym
            | NameUsageTaxonomicStatus::HeterotypicSynonym
            | NameUsageTaxonomicStatus::HomotypicSynonym
            | NameUsageTaxonomicStatus::ProparteSynonym,
        ) => ("SYNONYM", accepted_key),
        Some(NameUsageTaxonomicStatus::Misapplied) => ("MISAPPLIED", accepted_key),
        Some(NameUsageTaxonomicStatus::Doubtful) => ("DOUBTFUL", Some(target_key)),
        Some(NameUsageTaxonomicStatus::Accepted) | None => ("ACCEPTED", Some(target_key)),
    };

    rows.push(row_with_classification(
        target_key,
        name,
        &rank,
        status,
        accepted_taxon_key,
        parent_key,
        &accumulated,
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
    fn higher_rank_fallback_to_an_ancestor_is_detected() {
        let m = match_from_json(json!({
            "synonym": false,
            "usage": { "key": "216", "name": "Insecta", "canonicalName": "Insecta", "rank": "CLASS" },
            "diagnostics": { "matchType": "HIGHERRANK" }
        }));
        assert!(is_higher_rank_fallback(&m, "Anisoptera"));
    }

    #[test]
    fn exact_and_same_name_matches_are_not_fallbacks() {
        let exact = match_from_json(json!({
            "synonym": false,
            "usage": { "key": "1", "name": "Quercus alba", "canonicalName": "Quercus alba", "rank": "SPECIES" },
            "diagnostics": { "matchType": "EXACT" }
        }));
        assert!(!is_higher_rank_fallback(&exact, "Quercus alba"));

        // A HIGHERRANK usage that is the queried name itself is still the
        // right taxon. Names compare case-insensitively.
        let same_name = match_from_json(json!({
            "synonym": false,
            "usage": { "key": "60", "name": "Quercus", "canonicalName": "Quercus", "rank": "GENUS" },
            "diagnostics": { "matchType": "HIGHERRANK" }
        }));
        assert!(!is_higher_rank_fallback(&same_name, "quercus"));
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

    /// A GBIF response recorded on 2026-10-18, from `tests/fixtures`.
    fn fixture(name: &str) -> serde_json::Value {
        let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        let body = std::fs::read_to_string(&path).expect("fixture exists");
        serde_json::from_str(&body).expect("fixture is JSON")
    }

    fn usage_from_json(value: serde_json::Value) -> NameUsage {
        serde_json::from_value(value).expect("test fixture is a valid NameUsage")
    }

    #[test]
    fn v2_answers_a_deleted_backbone_key_with_no_usage() {
        let m = match_from_json(fixture("v2-match-usagekey-1875.json"));
        assert!(build_upstream_match(m).is_none());
    }

    #[test]
    fn v1_superfamily_maps_to_its_ancestors_plus_target() {
        let usage = usage_from_json(fixture("v1-species-1875.json"));
        let upstream = build_upstream_match_from_usage(&usage).expect("backbone usage");
        assert_eq!(upstream.target_key, 1875);

        let keys: Vec<i64> = upstream.rows.iter().map(|r| r.taxon_key).collect();
        assert_eq!(keys, vec![1, 54, 216, 797, 1875]);

        let target = upstream.rows.last().unwrap();
        assert_eq!(target.scientific_name, "Papilionoidea");
        assert_eq!(target.rank, "superfamily");
        assert_eq!(target.status, "ACCEPTED");
        assert_eq!(target.accepted_taxon_key, Some(1875));
        assert_eq!(target.parent_key, Some(797));
        assert_eq!(target.kingdom.as_deref(), Some("Animalia"));
        assert_eq!(target.class.as_deref(), Some("Insecta"));
        assert_eq!(target.class_key, Some(216));
        assert_eq!(target.order_.as_deref(), Some("Lepidoptera"));
        assert_eq!(target.order_key, Some(797));
        assert!(target.family.is_none());

        let lepidoptera = &upstream.rows[3];
        assert_eq!(lepidoptera.rank, "order");
        assert_eq!(lepidoptera.parent_key, Some(216));
        assert!(lepidoptera.order_key == Some(797) && lepidoptera.family_key.is_none());
        assert!(upstream.rows[0].parent_key.is_none());
    }

    #[test]
    fn v1_species_fills_its_own_rank_without_an_ancestor_row_for_itself() {
        let usage = usage_from_json(fixture("v1-species-1934362.json"));
        let upstream = build_upstream_match_from_usage(&usage).expect("backbone usage");

        let keys: Vec<i64> = upstream.rows.iter().map(|r| r.taxon_key).collect();
        assert_eq!(keys, vec![1, 54, 216, 797, 5473, 1934338, 1934362]);

        let target = upstream.rows.last().unwrap();
        assert_eq!(target.scientific_name, "Apodemia mormo");
        assert_eq!(target.rank, "species");
        assert_eq!(target.status, "DOUBTFUL");
        assert_eq!(target.accepted_taxon_key, Some(1934362));
        assert_eq!(target.parent_key, Some(1934338));
        assert_eq!(target.genus.as_deref(), Some("Apodemia"));
        assert_eq!(target.species.as_deref(), Some("Apodemia mormo"));
        assert_eq!(target.species_key, Some(1934362));
    }

    #[test]
    fn v1_synonym_points_at_its_accepted_key() {
        let usage = usage_from_json(json!({
            "key": 2878877,
            "datasetKey": "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c",
            "scientificName": "Quercus pedunculata typica",
            "canonicalName": "Quercus pedunculata typica",
            "rank": "VARIETY",
            "taxonomicStatus": "SYNONYM",
            "acceptedKey": 2878725,
            "origin": "SOURCE",
            "issues": [],
            "kingdom": "Plantae",
            "kingdomKey": 6,
        }));
        let upstream = build_upstream_match_from_usage(&usage).unwrap();
        let target = upstream.rows.last().unwrap();
        assert_eq!(target.status, "SYNONYM");
        assert_eq!(target.accepted_taxon_key, Some(2878725));
        assert_eq!(target.parent_key, Some(6));
    }

    #[test]
    fn v1_usage_outside_the_backbone_yields_no_match() {
        let usage = usage_from_json(json!({
            "key": 100000001,
            "datasetKey": "7ddf754f-d193-4cc9-b351-99906754a03b",
            "scientificName": "Apodemia mormo",
            "rank": "SPECIES",
            "taxonomicStatus": "ACCEPTED",
            "origin": "SOURCE",
            "issues": [],
            "kingdom": "Animalia",
            "kingdomKey": 100000002,
        }));
        assert!(build_upstream_match_from_usage(&usage).is_none());
    }

    mod get_by_key {
        use super::*;
        use wiremock::matchers::{method, path, query_param};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        async fn mock_v2(server: &MockServer, key: &str, body: serde_json::Value) {
            Mock::given(method("GET"))
                .and(path("/v2/species/match"))
                .and(query_param("usageKey", key))
                .respond_with(ResponseTemplate::new(200).set_body_json(body))
                .mount(server)
                .await;
        }

        #[tokio::test]
        async fn falls_back_to_v1_when_v2_has_no_usage() {
            let server = MockServer::start().await;
            mock_v2(&server, "1875", fixture("v2-match-usagekey-1875.json")).await;
            Mock::given(method("GET"))
                .and(path("/v1/species/1875"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(fixture("v1-species-1875.json")),
                )
                .expect(1)
                .mount(&server)
                .await;

            let upstream = GbifUpstream::with_base_url(&server.uri());
            let m = upstream.get_by_key(1875).await.unwrap().expect("v1 match");
            assert_eq!(m.target_key, 1875);
            assert_eq!(m.rows.last().unwrap().rank, "superfamily");
        }

        #[tokio::test]
        async fn skips_v1_when_v2_has_a_usage() {
            let server = MockServer::start().await;
            mock_v2(
                &server,
                "5231190",
                fixture("v2-match-usagekey-5231190.json"),
            )
            .await;
            Mock::given(method("GET"))
                .and(path("/v1/species/5231190"))
                .respond_with(ResponseTemplate::new(500))
                .expect(0)
                .mount(&server)
                .await;

            let upstream = GbifUpstream::with_base_url(&server.uri());
            let m = upstream
                .get_by_key(5231190)
                .await
                .unwrap()
                .expect("v2 match");
            assert_eq!(m.target_key, 5231190);
        }

        #[tokio::test]
        async fn no_match_when_v1_does_not_know_the_key_either() {
            let server = MockServer::start().await;
            mock_v2(&server, "999999999", fixture("v2-match-usagekey-1875.json")).await;
            Mock::given(method("GET"))
                .and(path("/v1/species/999999999"))
                .respond_with(ResponseTemplate::new(404))
                .mount(&server)
                .await;

            let upstream = GbifUpstream::with_base_url(&server.uri());
            assert!(upstream.get_by_key(999999999).await.unwrap().is_none());
        }

        #[tokio::test]
        async fn v1_server_errors_surface_as_upstream_errors() {
            let server = MockServer::start().await;
            mock_v2(&server, "1875", fixture("v2-match-usagekey-1875.json")).await;
            Mock::given(method("GET"))
                .and(path("/v1/species/1875"))
                .respond_with(ResponseTemplate::new(503))
                .mount(&server)
                .await;

            let upstream = GbifUpstream::with_base_url(&server.uri());
            let err = upstream.get_by_key(1875).await.unwrap_err();
            assert!(matches!(err, ResolveError::Upstream(_)));
        }
    }
}
