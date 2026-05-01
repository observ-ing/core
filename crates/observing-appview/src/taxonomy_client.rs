//! Public response types for the taxonomy API and a thin in-process
//! [`TaxonomyClient`] facade over [`crate::taxonomy::GbifClient`].
//!
//! Response shapes (`TaxonResult`, `TaxonDetail`, `ValidateResponse`, …) are
//! retained here as the canonical TS-bound types so generated bindings stay
//! stable across the service collapse.

use serde::{Deserialize, Serialize};
use std::fmt;
use ts_rs::TS;

use crate::taxonomy::GbifClient;

/// Error from the taxonomy resolver. Used to keep the `?`/`From` plumbing in
/// route handlers identical to the previous HTTP-client-era code.
#[derive(Debug)]
pub struct TaxonomyClientError(pub String);

impl fmt::Display for TaxonomyClientError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "taxonomy error: {}", self.0)
    }
}

impl From<gbif_api::GbifError> for TaxonomyClientError {
    fn from(e: gbif_api::GbifError) -> Self {
        Self(e.to_string())
    }
}

/// In-process taxonomy facade. Wraps [`GbifClient`] so routes can stay
/// agnostic to whether resolution happens locally or over HTTP.
pub struct TaxonomyClient {
    inner: GbifClient,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, rename = "TaxaResult", export_to = "bindings/")]
pub struct TaxonResult {
    pub id: String,
    pub scientific_name: String,
    #[ts(optional)]
    pub common_name: Option<String>,
    #[ts(optional)]
    pub photo_url: Option<String>,
    pub rank: String,
    #[ts(optional)]
    pub kingdom: Option<String>,
    #[ts(optional)]
    pub phylum: Option<String>,
    #[ts(optional)]
    pub class: Option<String>,
    #[ts(optional)]
    pub order: Option<String>,
    #[ts(optional)]
    pub family: Option<String>,
    #[ts(optional)]
    pub genus: Option<String>,
    #[ts(optional)]
    pub species: Option<String>,
    pub source: String,
    #[ts(optional)]
    pub conservation_status: Option<ConservationStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct ConservationStatus {
    pub category: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct TaxonAncestor {
    pub id: String,
    pub name: String,
    pub rank: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct TaxonDescription {
    pub description: String,
    #[ts(optional)]
    pub r#type: Option<String>,
    #[ts(optional)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct TaxonReference {
    pub citation: String,
    #[ts(optional)]
    pub doi: Option<String>,
    #[ts(optional)]
    pub link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct TaxonMedia {
    pub r#type: String,
    pub url: String,
    #[ts(optional)]
    pub title: Option<String>,
    #[ts(optional)]
    pub description: Option<String>,
    #[ts(optional)]
    pub source: Option<String>,
    #[ts(optional)]
    pub creator: Option<String>,
    #[ts(optional)]
    pub license: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct TaxonDetail {
    pub id: String,
    pub scientific_name: String,
    #[ts(optional)]
    pub common_name: Option<String>,
    #[ts(optional)]
    pub photo_url: Option<String>,
    pub rank: String,
    #[ts(optional)]
    pub kingdom: Option<String>,
    #[ts(optional)]
    pub phylum: Option<String>,
    #[ts(optional)]
    pub class: Option<String>,
    #[ts(optional)]
    pub order: Option<String>,
    #[ts(optional)]
    pub family: Option<String>,
    #[ts(optional)]
    pub genus: Option<String>,
    #[ts(optional)]
    pub species: Option<String>,
    pub source: String,
    #[ts(optional)]
    pub conservation_status: Option<ConservationStatus>,
    #[ts(optional)]
    pub description: Option<String>,
    #[ts(optional)]
    pub wikidata_id: Option<String>,
    #[serde(default)]
    pub ancestors: Vec<TaxonAncestor>,
    #[serde(default)]
    pub children: Vec<TaxonResult>,
    #[ts(optional, type = "number")]
    pub num_descendants: Option<u64>,
    #[ts(optional)]
    pub extinct: Option<bool>,
    #[ts(optional)]
    pub descriptions: Option<Vec<TaxonDescription>>,
    #[ts(optional)]
    pub references: Option<Vec<TaxonReference>>,
    #[ts(optional)]
    pub media: Option<Vec<TaxonMedia>>,
    #[ts(optional)]
    pub gbif_url: Option<String>,
    #[ts(optional)]
    pub wikidata_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct TaxonDetailWithCount {
    #[serde(flatten)]
    pub detail: TaxonDetail,
    pub observation_count: i64,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct ValidateResponse {
    pub valid: bool,
    #[serde(rename = "matchedName")]
    #[ts(optional)]
    pub matched_name: Option<String>,
    #[ts(optional)]
    pub taxon: Option<TaxonResult>,
    #[ts(optional)]
    pub suggestions: Option<Vec<TaxonResult>>,
}

/// Extracted taxon fields from a GBIF validation result.
///
/// Used when creating identifications or occurrences to avoid duplicating
/// the field-extraction logic that maps a [`ValidateResponse`] into the
/// individual optional columns stored alongside records.
#[derive(Debug, Default)]
pub struct TaxonFields {
    pub taxon_id: Option<String>,
    pub taxon_rank: Option<String>,
    pub kingdom: Option<String>,
    pub phylum: Option<String>,
    pub class: Option<String>,
    pub order: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
}

impl TaxonFields {
    /// Validate a scientific name via the taxonomy resolver and extract the
    /// classification fields from the response.
    ///
    /// `rank_override` is an optional caller-supplied rank (e.g. from user
    /// input). When present it takes priority over the rank returned by GBIF.
    ///
    /// `kingdom_hint` is forwarded to GBIF for disambiguation (essential for
    /// genus-level names that overlap across kingdoms, where a hint-less
    /// validate often returns no taxon at all). It also acts as a fallback
    /// when the validation succeeds but doesn't carry a kingdom of its own.
    pub async fn from_validation(
        taxonomy: &TaxonomyClient,
        scientific_name: &str,
        rank_override: Option<String>,
        kingdom_hint: Option<&str>,
    ) -> Self {
        let mut fields = TaxonFields {
            taxon_rank: rank_override,
            ..Default::default()
        };

        if let Some(validation) = taxonomy.validate(scientific_name, kingdom_hint).await {
            if let Some(ref t) = validation.taxon {
                fields.taxon_id = Some(t.id.clone());
                if fields.taxon_rank.is_none() {
                    fields.taxon_rank = Some(t.rank.clone());
                }
                fields.kingdom = t.kingdom.clone();
                fields.phylum = t.phylum.clone();
                fields.class = t.class.clone();
                fields.order = t.order.clone();
                fields.family = t.family.clone();
                fields.genus = t.genus.clone();
            }
        }

        // Don't lose the caller's kingdom if validation didn't supply one.
        if fields.kingdom.is_none() {
            fields.kingdom = kingdom_hint.map(str::to_string);
        }

        fields
    }
}

impl TaxonomyClient {
    /// Construct a new client backed by an in-memory GBIF + Wikidata stack.
    pub fn new() -> Self {
        Self {
            inner: GbifClient::new(),
        }
    }

    /// Snapshot of the inner GBIF cache (entries / hits / misses).
    #[allow(dead_code)] // exposed for future health/diagnostics endpoint
    pub fn cache_stats(&self) -> crate::taxonomy::CacheStats {
        self.inner.cache_stats()
    }

    /// Search taxa by name. Returns `None` only on internal failure; the
    /// inner client logs and returns an empty list for empty/erroring queries
    /// so most callers can use `.unwrap_or_default()`.
    pub async fn search(&self, query: &str, limit: Option<u32>) -> Option<Vec<TaxonResult>> {
        Some(self.inner.search(query, limit.unwrap_or(10)).await)
    }

    /// Validate a taxon name with an optional kingdom hint for GBIF
    /// disambiguation. Returns `None` if the lookup itself failed —
    /// preserved for parity with the prior HTTP client.
    pub async fn validate(
        &self,
        name: &str,
        kingdom_hint: Option<&str>,
    ) -> Option<ValidateResponse> {
        Some(self.inner.validate(name, kingdom_hint).await)
    }

    /// Get taxon detail by GBIF ID (`gbif:NNN` or bare numeric).
    pub async fn get_by_id(&self, id: &str) -> Result<Option<TaxonDetail>, TaxonomyClientError> {
        Ok(self.inner.get_by_id(id).await?)
    }

    /// Get taxon detail by scientific name with optional kingdom hint.
    pub async fn get_by_name(
        &self,
        name: &str,
        kingdom: Option<&str>,
    ) -> Result<Option<TaxonDetail>, TaxonomyClientError> {
        Ok(self.inner.get_by_name(name, kingdom).await?)
    }

    /// Get children of a taxon by scientific name with optional kingdom hint.
    /// Returns `Ok(None)` only on lookup failure; an empty parent yields
    /// `Ok(Some(vec![]))`.
    pub async fn get_children(
        &self,
        name: &str,
        kingdom: Option<&str>,
    ) -> Result<Option<Vec<TaxonResult>>, TaxonomyClientError> {
        Ok(Some(
            self.inner.get_children_by_name(name, kingdom, 20).await?,
        ))
    }
}

impl Default for TaxonomyClient {
    fn default() -> Self {
        Self::new()
    }
}
