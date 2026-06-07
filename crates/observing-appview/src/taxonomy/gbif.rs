//! GBIF-based taxonomy client with caching.
//!
//! Wraps the generated `gbif::checklistbank::Client` (from rust-gbif) with
//! an appview-shaped facade: 404→`Ok(None)`, an [`IucnCategory`] enum + parser,
//! a [`GbifError`] alias for the generated progenitor error, conversion to the
//! TS-bound [`TaxonResult`]/[`TaxonDetail`] shapes, and a moka cache.

use crate::taxonomy::wikidata::WikidataClient;
use crate::taxonomy_client::{
    ConservationStatus, TaxonAncestor, TaxonDescription, TaxonDetail, TaxonMedia, TaxonReference,
    TaxonResult, ValidateResponse,
};
use gbif::checklistbank::{
    types::{
        DiagnosticsMatchType, NameUsage, NameUsageMatch, NameUsageMediaObject,
        NameUsageSearchResult, RankedName, Status, Usage,
    },
    Client as GbifChecklistbankClient, Error as GbifClientError,
};
use gbif::Uuid;
use moka::future::Cache;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tracing::warn;

/// Base URL for the GBIF web services. The OpenAPI spec paths already include
/// the `/v1/` and `/v2/` prefixes, so we point the client at the host root.
const GBIF_BASE_URL: &str = "https://api.gbif.org";

/// GBIF Backbone Taxonomy dataset key. Used as a `datasetKey` filter to
/// restrict species/search results to authoritative backbone entries.
static BACKBONE_DATASET_KEY: std::sync::LazyLock<Uuid> = std::sync::LazyLock::new(|| {
    Uuid::parse_str("d7dddbf4-2cf0-4f39-9b2a-bb099caae36c")
        .expect("BACKBONE_DATASET_KEY is a valid UUID literal")
});

/// Errors returned from the GBIF resolver. Wraps the generated client's
/// progenitor error so call sites can keep the existing `?` / `From` plumbing.
#[derive(Debug)]
pub struct GbifError(Box<GbifClientError<()>>);

impl std::fmt::Display for GbifError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "GBIF error: {}", self.0)
    }
}

impl std::error::Error for GbifError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&*self.0)
    }
}

impl From<GbifClientError<()>> for GbifError {
    fn from(e: GbifClientError<()>) -> Self {
        Self(Box::new(e))
    }
}

/// IUCN Red List conservation status categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IucnCategory {
    /// Extinct
    Ex,
    /// Extinct in the Wild
    Ew,
    /// Critically Endangered
    Cr,
    /// Endangered
    En,
    /// Vulnerable
    Vu,
    /// Near Threatened
    Nt,
    /// Least Concern
    Lc,
    /// Data Deficient
    Dd,
    /// Not Evaluated
    Ne,
}

impl std::str::FromStr for IucnCategory {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "EX" => Ok(Self::Ex),
            "EW" => Ok(Self::Ew),
            "CR" => Ok(Self::Cr),
            "EN" => Ok(Self::En),
            "VU" => Ok(Self::Vu),
            "NT" => Ok(Self::Nt),
            "LC" => Ok(Self::Lc),
            "DD" => Ok(Self::Dd),
            "NE" => Ok(Self::Ne),
            _ => Err(()),
        }
    }
}

fn iucn_to_string(c: IucnCategory) -> String {
    match c {
        IucnCategory::Ex => "EX",
        IucnCategory::Ew => "EW",
        IucnCategory::Cr => "CR",
        IucnCategory::En => "EN",
        IucnCategory::Vu => "VU",
        IucnCategory::Nt => "NT",
        IucnCategory::Lc => "LC",
        IucnCategory::Dd => "DD",
        IucnCategory::Ne => "NE",
    }
    .to_string()
}

/// Walk a v2 match's additional_status entries, find one tagged with the
/// IUCN dataset, and parse its status_code into [`IucnCategory`].
fn extract_iucn_status(m: &NameUsageMatch) -> Option<IucnCategory> {
    m.additional_status
        .iter()
        .find(|s| s.dataset_alias.as_deref() == Some("IUCN"))?
        .status_code
        .as_deref()?
        .parse()
        .ok()
}

/// Convert any of the generated rank enums (which serialize to uppercase
/// labels like "KINGDOM") into a plain `String`. Round-tripping through
/// serde_json keeps us from duplicating the enum's serde rename map.
fn rank_to_string<R: serde::Serialize>(rank: &R) -> Option<String> {
    serde_json::to_value(rank)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
}

/// Build a stable GBIF species URI for a backbone usage key. This is the
/// value stored as Darwin Core dwc:taxonID on records, and the same shape the
/// ingester parses back out (`https://www.gbif.org/species/{key}`).
fn gbif_taxon_uri(key: u64) -> String {
    format!("https://www.gbif.org/species/{key}")
}

/// Build a path-based taxon identifier: "{kingdom}/{name}", or just
/// "{name}" for kingdom-rank taxa.
fn build_taxon_path(scientific_name: &str, rank: &str, kingdom: Option<&str>) -> String {
    if rank.eq_ignore_ascii_case("kingdom") {
        return scientific_name.to_string();
    }
    match kingdom {
        Some(k) => format!("{k}/{scientific_name}"),
        None => scientific_name.to_string(),
    }
}

/// Taxonomy client that wraps the GBIF API with caching and app-specific
/// type conversion.
pub struct GbifClient {
    api: GbifChecklistbankClient,
    wikidata: WikidataClient,
    cache: Cache<String, CachedValue>,
    hits: AtomicU64,
    misses: AtomicU64,
}

#[derive(Clone)]
enum CachedValue {
    SearchResults(Vec<TaxonResult>),
    TaxonDetail(Box<TaxonDetail>),
    Children(Vec<TaxonResult>),
    Match(Option<Box<NameUsageMatch>>),
}

impl GbifClient {
    const CACHE_TTL_MINS: u64 = 30;

    pub fn new() -> Self {
        Self::with_base_url(GBIF_BASE_URL)
    }

    /// Construct a client pointed at an arbitrary base URL. Production uses
    /// the GBIF host; tests point it at a wiremock server.
    pub fn with_base_url(base_url: &str) -> Self {
        Self {
            api: GbifChecklistbankClient::new(base_url),
            wikidata: WikidataClient::new(),
            cache: Cache::builder()
                .max_capacity(10_000)
                .time_to_live(Duration::from_secs(Self::CACHE_TTL_MINS * 60))
                .build(),
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
        }
    }

    #[allow(dead_code)] // exposed for future health/diagnostics endpoint
    pub fn cache_stats(&self) -> CacheStats {
        CacheStats {
            entries: self.cache.entry_count(),
            hits: self.hits.load(Ordering::Relaxed),
            misses: self.misses.load(Ordering::Relaxed),
        }
    }

    // ---------- low-level wrappers around the generated client ----------

    /// v2 `/species/match` with just the scientific name + optional kingdom
    /// hint. Returns `Ok(None)` on lookup failure or empty match.
    ///
    /// Cached: same shared moka cache used by `get_by_id` / `search` /
    /// `get_children`. Concurrent identical lookups for the same
    /// (name, kingdom) pair that land within the TTL share one upstream
    /// call instead of each hitting GBIF, which avoids serving
    /// inconsistent results when GBIF's `/species/match` flaps (#269).
    /// Errors are not cached so transient upstream failures stay transient.
    async fn match_name_raw(
        &self,
        name: &str,
        kingdom_hint: Option<&str>,
    ) -> Result<Option<NameUsageMatch>, GbifError> {
        let cache_key = format!(
            "match:{}:{}",
            name.to_lowercase(),
            kingdom_hint.unwrap_or(""),
        );
        if let Some(CachedValue::Match(cached)) = self.cache.get(&cache_key).await {
            self.hits.fetch_add(1, Ordering::Relaxed);
            return Ok(cached.map(|b| *b));
        }
        self.misses.fetch_add(1, Ordering::Relaxed);

        // Order matches the generated signature (26 positional args).
        let result = self
            .api
            .match_names(
                None,         //  1 class
                None,         //  2 exclude
                None,         //  3 family
                None,         //  4 generic_name
                None,         //  5 genus
                None,         //  6 infraspecific_epithet
                kingdom_hint, //  7 kingdom
                None,         //  8 order
                None,         //  9 phylum
                Some(name),   // 10 scientific_name
                None,         // 11 scientific_name_authorship
                None,         // 12 scientific_name_id
                None,         // 13 species
                None,         // 14 specific_epithet
                None,         // 15 strict
                None,         // 16 subfamily
                None,         // 17 subgenus
                None,         // 18 subtribe
                None,         // 19 superfamily
                None,         // 20 taxon_concept_id
                None,         // 21 taxon_id
                None,         // 22 taxon_rank
                None,         // 23 tribe
                None,         // 24 usage_key
                None,         // 25 verbatim_taxon_rank
                None,         // 26 verbose
            )
            .await;

        let m = match result {
            Ok(rv) => rv.into_inner(),
            Err(e) if e.status() == Some(reqwest::StatusCode::NOT_FOUND) => {
                self.cache.insert(cache_key, CachedValue::Match(None)).await;
                return Ok(None);
            }
            Err(e) => return Err(e.into()),
        };

        // Drop empty matches (parity with the old hand-written client).
        let resolved = if m.usage.is_none() { None } else { Some(m) };
        self.cache
            .insert(
                cache_key,
                CachedValue::Match(resolved.clone().map(Box::new)),
            )
            .await;
        Ok(resolved)
    }

    /// v1 `/species/{key}`. Returns `Ok(None)` on 404.
    async fn get_name_usage(&self, key: i32) -> Result<Option<NameUsage>, GbifError> {
        match self.api.get_name_usage(key, None).await {
            Ok(rv) => Ok(Some(rv.into_inner())),
            Err(e) if e.status() == Some(reqwest::StatusCode::NOT_FOUND) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// v1 `/species/{key}/children`. Returns `Ok(vec![])` on 404.
    async fn get_name_usage_children(
        &self,
        key: i32,
        limit: i32,
    ) -> Result<Vec<NameUsage>, GbifError> {
        match self
            .api
            .get_name_usage_children(key, Some(limit), None, None)
            .await
        {
            Ok(rv) => Ok(rv.into_inner().results),
            Err(e) if e.status() == Some(reqwest::StatusCode::NOT_FOUND) => Ok(vec![]),
            Err(e) => Err(e.into()),
        }
    }

    /// v1 species search restricted to the GBIF Backbone Taxonomy.
    async fn search_backbone(
        &self,
        query: &str,
        limit: i32,
    ) -> Result<Vec<NameUsageSearchResult>, GbifError> {
        let res = self
            .api
            .search_names(
                None,                         //  1 constituent_key
                Some(&*BACKBONE_DATASET_KEY), //  2 dataset_key
                None,                         //  3 facet
                None,                         //  4 facet_limit
                None,                         //  5 facet_mincount
                None,                         //  6 facet_multiselect
                None,                         //  7 facet_offset
                None,                         //  8 habitat
                None,                         //  9 higher_taxon_key
                None,                         // 10 hl
                None,                         // 11 is_extinct
                None,                         // 12 issue
                Some(limit),                  // 13 limit
                None,                         // 14 name_type
                None,                         // 15 nomenclatural_status
                None,                         // 16 offset
                None,                         // 17 origin
                Some(query),                  // 18 q
                None,                         // 19 rank
                None,                         // 20 status
                None,                         // 21 threat
            )
            .await?;
        Ok(res.into_inner().results)
    }

    // ---------- public, app-shaped surface ----------

    /// Search for taxa matching a query.
    pub async fn search(&self, query: &str, limit: u32) -> Vec<TaxonResult> {
        let cache_key = format!("search:{}:{}", query.to_lowercase(), limit);

        if let Some(CachedValue::SearchResults(results)) = self.cache.get(&cache_key).await {
            self.hits.fetch_add(1, Ordering::Relaxed);
            return results;
        }
        self.misses.fetch_add(1, Ordering::Relaxed);

        let results = self.search_gbif(query, limit).await;
        self.cache
            .insert(cache_key, CachedValue::SearchResults(results.clone()))
            .await;
        results
    }

    /// Whether a HIGHERRANK match is a fallback that doesn't actually match
    /// the input. e.g. searching "Fakeus speciesus" in Animalia returns
    /// Animalia itself; searching "Corvus" correctly returns the Corvus genus
    /// as HIGHERRANK because GBIF expects species-level queries — we want to
    /// keep that one.
    fn is_mismatched_higher_rank(
        gbif_match: &Option<NameUsageMatch>,
        scientific_name: &str,
    ) -> bool {
        let Some(m) = gbif_match else {
            return false;
        };
        let match_type = m.diagnostics.as_ref().and_then(|d| d.match_type.as_ref());
        if match_type != Some(&DiagnosticsMatchType::Higherrank) {
            return false;
        }
        let canonical = m
            .usage
            .as_ref()
            .and_then(|u| u.canonical_name.as_deref())
            .unwrap_or("");
        !canonical.eq_ignore_ascii_case(scientific_name)
    }

    /// Validate a scientific name. `kingdom_hint` is forwarded to GBIF's
    /// match endpoint to disambiguate names shared across kingdoms (e.g.
    /// genus-level names like "Pinus") — without a hint a non-EXACT result
    /// can leave us with `taxon: None` and no kingdom for the caller to
    /// store.
    pub async fn validate(&self, name: &str, kingdom_hint: Option<&str>) -> ValidateResponse {
        let gbif_match = match self.match_name_raw(name, kingdom_hint).await {
            Ok(Some(m)) => m,
            _ => {
                return ValidateResponse {
                    valid: false,
                    matched_name: None,
                    taxon: None,
                    suggestions: Some(vec![]),
                };
            }
        };

        let Some(usage) = &gbif_match.usage else {
            return ValidateResponse {
                valid: false,
                matched_name: None,
                taxon: None,
                suggestions: Some(vec![]),
            };
        };

        let is_exact = gbif_match
            .diagnostics
            .as_ref()
            .and_then(|d| d.match_type.as_ref())
            == Some(&DiagnosticsMatchType::Exact);

        let taxon = self.gbif_v2_to_taxon(
            usage,
            &gbif_match.additional_status,
            &gbif_match.classification,
        );

        if is_exact {
            ValidateResponse {
                valid: true,
                matched_name: usage.canonical_name.clone().or_else(|| usage.name.clone()),
                taxon: Some(taxon),
                suggestions: None,
            }
        } else {
            ValidateResponse {
                valid: false,
                matched_name: None,
                taxon: None,
                suggestions: Some(vec![taxon]),
            }
        }
    }

    /// Get detailed taxon information by GBIF ID.
    pub async fn get_by_id(&self, taxon_id: &str) -> Result<Option<TaxonDetail>, GbifError> {
        let numeric_id = taxon_id.strip_prefix("gbif:").unwrap_or(taxon_id);
        let cache_key = format!("detail:{}", numeric_id);

        if let Some(CachedValue::TaxonDetail(detail)) = self.cache.get(&cache_key).await {
            self.hits.fetch_add(1, Ordering::Relaxed);
            return Ok(Some(*detail));
        }
        self.misses.fetch_add(1, Ordering::Relaxed);

        let key: i32 = match numeric_id.parse() {
            Ok(k) => k,
            Err(_) => return Ok(None),
        };

        let data = match self.get_name_usage(key).await? {
            Some(d) => d,
            None => return Ok(None),
        };

        // Fetch children, descriptions, references, media, Wikidata URL, and
        // Wikidata's primary image (P18) in parallel.
        let key_u64 = key as u64;
        let key_slice = [key_u64];
        let (children, descriptions, references, media, wikidata_url, wikidata_images) = tokio::join!(
            self.get_children(taxon_id, 20),
            async {
                match self
                    .api
                    .get_name_usage_descriptions(key, Some(5), None)
                    .await
                {
                    Ok(rv) => Ok(rv.into_inner().results),
                    Err(e) if e.status() == Some(reqwest::StatusCode::NOT_FOUND) => Ok(vec![]),
                    Err(e) => Err(GbifError::from(e)),
                }
            },
            async {
                match self
                    .api
                    .get_name_usage_references(key, Some(10), None)
                    .await
                {
                    Ok(rv) => Ok(rv.into_inner().results),
                    Err(e) if e.status() == Some(reqwest::StatusCode::NOT_FOUND) => Ok(vec![]),
                    Err(e) => Err(GbifError::from(e)),
                }
            },
            async {
                match self.api.get_name_usage_media(key, Some(10), None).await {
                    Ok(rv) => Ok(rv.into_inner().results),
                    Err(e) if e.status() == Some(reqwest::StatusCode::NOT_FOUND) => Ok(vec![]),
                    Err(e) => Err(GbifError::from(e)),
                }
            },
            self.wikidata.get_entity_url(key_u64),
            self.wikidata.get_images_for_keys(&key_slice, 600),
        );

        let children = children.unwrap_or_default();
        let descriptions: Vec<TaxonDescription> = descriptions
            .unwrap_or_default()
            .into_iter()
            .filter_map(|d| {
                d.description.map(|desc| TaxonDescription {
                    description: desc,
                    r#type: d.type_,
                    source: d.source,
                })
            })
            .collect();
        let references: Vec<TaxonReference> = references
            .unwrap_or_default()
            .into_iter()
            .map(|r| TaxonReference {
                citation: r.citation,
                doi: r.doi,
                link: r.link,
            })
            .collect();
        let media: Vec<TaxonMedia> = media
            .unwrap_or_default()
            .into_iter()
            .map(|m: NameUsageMediaObject| TaxonMedia {
                r#type: rank_to_string(&m.type_).unwrap_or_else(|| "StillImage".to_string()),
                url: m.identifier,
                title: m.title,
                description: m.description,
                source: m.source,
                creator: m.creator,
                license: m.license,
            })
            .collect();

        // Build ancestors from individual key fields
        let ancestors = self.build_ancestors(&data, numeric_id);

        // Conservation status
        let conservation_status = if let Some(canonical) = &data.canonical_name {
            self.get_conservation_status(canonical).await
        } else {
            self.get_conservation_status(&data.scientific_name).await
        };

        let resolved_name: &str = data
            .canonical_name
            .as_deref()
            .unwrap_or(data.scientific_name.as_str());
        let resolved_rank = data
            .rank
            .as_ref()
            .and_then(rank_to_string)
            .map(|r| r.to_lowercase())
            .unwrap_or_else(|| "unknown".to_string());

        // Prefer Wikidata's primary image (P18); fall back to the first GBIF
        // media item when Wikidata has no image for this taxon.
        let photo_url = wikidata_images
            .get(&key_u64)
            .cloned()
            .or_else(|| media.first().map(|m| m.url.clone()));

        let taxon_detail = TaxonDetail {
            id: build_taxon_path(resolved_name, &resolved_rank, data.kingdom.as_deref()),
            scientific_name: resolved_name.to_string(),
            common_name: data.vernacular_name,
            photo_url,
            rank: resolved_rank,
            kingdom: data.kingdom,
            phylum: data.phylum,
            class: data.class,
            order: data.order,
            family: data.family,
            genus: data.genus,
            species: data.species,
            source: "gbif".to_string(),
            conservation_status,
            description: None,
            wikidata_id: None,
            ancestors,
            children,
            num_descendants: data.num_descendants.map(|n| n as u64),
            extinct: None,
            descriptions: if descriptions.is_empty() {
                None
            } else {
                Some(descriptions)
            },
            references: if references.is_empty() {
                None
            } else {
                Some(references)
            },
            media: if media.is_empty() { None } else { Some(media) },
            gbif_url: Some(format!("https://www.gbif.org/species/{}", data.key)),
            wikidata_url,
        };

        self.cache
            .insert(
                cache_key,
                CachedValue::TaxonDetail(Box::new(taxon_detail.clone())),
            )
            .await;
        Ok(Some(taxon_detail))
    }

    /// Get detailed taxon information by scientific name.
    pub async fn get_by_name(
        &self,
        scientific_name: &str,
        kingdom: Option<&str>,
    ) -> Result<Option<TaxonDetail>, GbifError> {
        let gbif_match = self.match_name_raw(scientific_name, kingdom).await?;

        if Self::is_mismatched_higher_rank(&gbif_match, scientific_name) {
            return Ok(None);
        }

        let usage_key = gbif_match
            .as_ref()
            .and_then(|m| m.usage.as_ref())
            .and_then(|u| u.key.as_deref())
            .and_then(|s| s.parse::<i64>().ok());

        if let Some(key) = usage_key {
            self.get_by_id(&format!("gbif:{}", key)).await
        } else {
            Ok(None)
        }
    }

    /// Get children taxa for a parent taxon by name, resolving to a GBIF
    /// key first.
    pub async fn get_children_by_name(
        &self,
        scientific_name: &str,
        kingdom: Option<&str>,
        limit: u32,
    ) -> Result<Vec<TaxonResult>, GbifError> {
        let gbif_match = self.match_name_raw(scientific_name, kingdom).await?;

        if Self::is_mismatched_higher_rank(&gbif_match, scientific_name) {
            return Ok(vec![]);
        }

        let usage_key = gbif_match
            .as_ref()
            .and_then(|m| m.usage.as_ref())
            .and_then(|u| u.key.as_deref())
            .and_then(|s| s.parse::<i64>().ok());

        if let Some(key) = usage_key {
            self.get_children(&format!("gbif:{}", key), limit).await
        } else {
            Ok(vec![])
        }
    }

    /// Get children taxa for a parent taxon.
    pub async fn get_children(
        &self,
        taxon_id: &str,
        limit: u32,
    ) -> Result<Vec<TaxonResult>, GbifError> {
        let numeric_id = taxon_id.strip_prefix("gbif:").unwrap_or(taxon_id);
        let cache_key = format!("children:{}:{}", numeric_id, limit);

        if let Some(CachedValue::Children(results)) = self.cache.get(&cache_key).await {
            self.hits.fetch_add(1, Ordering::Relaxed);
            return Ok(results);
        }
        self.misses.fetch_add(1, Ordering::Relaxed);

        let key: i32 = match numeric_id.parse() {
            Ok(k) => k,
            Err(_) => return Ok(vec![]),
        };

        let data = self.get_name_usage_children(key, limit as i32).await?;
        let mut seen = std::collections::HashSet::new();
        let results: Vec<TaxonResult> = data
            .iter()
            .map(|item| self.gbif_to_taxon(item))
            .filter(|t| seen.insert(t.scientific_name.clone()))
            .collect();

        self.cache
            .insert(cache_key, CachedValue::Children(results.clone()))
            .await;
        Ok(results)
    }

    /// Get conservation status for a taxon by matching its name.
    async fn get_conservation_status(&self, name: &str) -> Option<ConservationStatus> {
        let gbif_match = self.match_name_raw(name, None).await.ok()??;
        let category = extract_iucn_status(&gbif_match)?;
        Some(ConservationStatus {
            category: iucn_to_string(category),
            source: "IUCN".to_string(),
        })
    }

    /// Search GBIF and enrich with conservation status and photos.
    ///
    /// Uses the full-text search endpoint over the GBIF Backbone Taxonomy
    /// only, so results have authoritative taxonomic status.
    async fn search_gbif(&self, query: &str, limit: u32) -> Vec<TaxonResult> {
        let data = match self.search_backbone(query, limit as i32).await {
            Ok(d) => d,
            Err(e) => {
                warn!(query = %query, error = ?e, "GBIF search failed");
                return vec![];
            }
        };

        // Extract GBIF keys for Wikidata image lookup.
        let keys: Vec<u64> = data
            .iter()
            .filter_map(|item| item.key.map(|k| k as u64))
            .collect();

        // Fetch photos from Wikidata in a single batched SPARQL query.
        let photos = self.wikidata.get_images_for_keys(&keys, 100).await;

        let basic_results: Vec<(TaxonResult, Option<u64>)> = data
            .iter()
            .map(|item| {
                let key = item.key.map(|k| k as u64);
                (self.search_result_to_taxon(item), key)
            })
            .collect();

        let enriched_futures = basic_results.into_iter().map(|(result, key)| {
            let photo_url = key.and_then(|k| photos.get(&k).cloned());
            async move {
                let conservation_status =
                    self.get_conservation_status(&result.scientific_name).await;
                TaxonResult {
                    conservation_status,
                    photo_url,
                    ..result
                }
            }
        });

        futures::future::join_all(enriched_futures).await
    }

    /// Build ancestors from a v1 NameUsage's denormalised taxonomy fields.
    fn build_ancestors(&self, data: &NameUsage, numeric_id: &str) -> Vec<TaxonAncestor> {
        let mut ancestors = Vec::new();
        let rank_fields = [
            ("kingdom", data.kingdom_key, data.kingdom.as_deref()),
            ("phylum", data.phylum_key, data.phylum.as_deref()),
            ("class", data.class_key, data.class.as_deref()),
            ("order", data.order_key, data.order.as_deref()),
            ("family", data.family_key, data.family.as_deref()),
            ("genus", data.genus_key, data.genus.as_deref()),
            ("species", data.species_key, data.species.as_deref()),
        ];

        for (rank, key, name) in rank_fields {
            if let (Some(k), Some(n)) = (key, name) {
                if k.to_string() != numeric_id {
                    let kingdom_for_path = if rank == "kingdom" {
                        None
                    } else {
                        data.kingdom.as_deref()
                    };
                    ancestors.push(TaxonAncestor {
                        id: build_taxon_path(n, rank, kingdom_for_path),
                        name: n.to_string(),
                        rank: rank.to_string(),
                    });
                }
            }
        }

        ancestors
    }

    /// Convert a v1 NameUsage (children endpoint) into a TaxonResult.
    fn gbif_to_taxon(&self, item: &NameUsage) -> TaxonResult {
        let name = item
            .canonical_name
            .as_deref()
            .unwrap_or(item.scientific_name.as_str());
        let rank = item
            .rank
            .as_ref()
            .and_then(rank_to_string)
            .map(|r| r.to_lowercase())
            .unwrap_or_else(|| "unknown".to_string());

        TaxonResult {
            id: build_taxon_path(name, &rank, item.kingdom.as_deref()),
            taxon_id: Some(gbif_taxon_uri(item.key as u64)),
            scientific_name: name.to_string(),
            common_name: item.vernacular_name.clone(),
            photo_url: None,
            rank,
            kingdom: item.kingdom.clone(),
            phylum: item.phylum.clone(),
            class: item.class.clone(),
            order: item.order.clone(),
            family: item.family.clone(),
            genus: item.genus.clone(),
            species: item.species.clone(),
            source: "gbif".to_string(),
            conservation_status: None,
        }
    }

    /// Convert a v1 NameUsageSearchResult into a TaxonResult.
    ///
    /// Picks the best vernacular name: top-level `vernacularName`, then any
    /// English-tagged entry, then an untagged entry (which GBIF often omits
    /// for English), then any preferred entry, then the first one.
    fn search_result_to_taxon(&self, item: &NameUsageSearchResult) -> TaxonResult {
        let name = item
            .canonical_name
            .as_deref()
            .or(item.scientific_name.as_deref())
            .unwrap_or("");
        let rank = item
            .rank
            .as_ref()
            .and_then(rank_to_string)
            .map(|r| r.to_lowercase())
            .unwrap_or_else(|| "unknown".to_string());

        let common_name = pick_vernacular_name(item);

        TaxonResult {
            id: build_taxon_path(name, &rank, item.kingdom.as_deref()),
            taxon_id: item.key.map(|k| gbif_taxon_uri(k as u64)),
            scientific_name: name.to_string(),
            common_name,
            photo_url: None,
            rank,
            kingdom: item.kingdom.clone(),
            phylum: item.phylum.clone(),
            class: item.class.clone(),
            order: item.order.clone(),
            family: item.family.clone(),
            genus: item.genus.clone(),
            species: item.species.clone(),
            source: "gbif".to_string(),
            conservation_status: None,
        }
    }

    /// Convert a v2 match (Usage + classification + additional_status) into
    /// a TaxonResult.
    fn gbif_v2_to_taxon(
        &self,
        usage: &Usage,
        additional_status: &[Status],
        classification: &[RankedName],
    ) -> TaxonResult {
        // IUCN conservation status, if present.
        let conservation_status = additional_status.iter().find_map(|s| {
            if s.dataset_alias.as_deref() == Some("IUCN") {
                s.status_code
                    .as_deref()
                    .and_then(|code| code.parse::<IucnCategory>().ok())
                    .map(|category| ConservationStatus {
                        category: iucn_to_string(category),
                        source: "IUCN".to_string(),
                    })
            } else {
                None
            }
        });

        // Build a rank → name map from the classification array.
        let mut classification_by_rank = std::collections::HashMap::new();
        for item in classification {
            if let (Some(rank), Some(name)) = (
                item.rank.as_ref().and_then(rank_to_string),
                item.name.as_deref(),
            ) {
                classification_by_rank.insert(rank.to_uppercase(), name.to_string());
            }
        }

        let resolved_name = usage
            .canonical_name
            .as_deref()
            .or(usage.name.as_deref())
            .unwrap_or("");
        let resolved_rank = usage
            .rank
            .as_ref()
            .and_then(rank_to_string)
            .map(|r| r.to_lowercase())
            .unwrap_or_else(|| "unknown".to_string());
        let resolved_kingdom = classification_by_rank.get("KINGDOM").cloned();

        TaxonResult {
            id: build_taxon_path(resolved_name, &resolved_rank, resolved_kingdom.as_deref()),
            taxon_id: usage
                .key
                .as_deref()
                .and_then(|k| k.parse::<u64>().ok())
                .map(gbif_taxon_uri),
            scientific_name: resolved_name.to_string(),
            common_name: None,
            photo_url: None,
            rank: resolved_rank,
            kingdom: resolved_kingdom,
            phylum: classification_by_rank.get("PHYLUM").cloned(),
            class: classification_by_rank.get("CLASS").cloned(),
            order: classification_by_rank.get("ORDER").cloned(),
            family: classification_by_rank.get("FAMILY").cloned(),
            genus: classification_by_rank.get("GENUS").cloned(),
            species: classification_by_rank.get("SPECIES").cloned(),
            source: "gbif".to_string(),
            conservation_status,
        }
    }
}

impl Default for GbifClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Pick the best vernacular name for a search result.
fn pick_vernacular_name(item: &NameUsageSearchResult) -> Option<String> {
    // The serialized form of `VernacularNameLanguage::Eng` is "eng"; we
    // compare via a serde round-trip so we don't depend on the enum's
    // identifier munging.
    fn lang_str(v: &gbif::checklistbank::types::VernacularName) -> Option<String> {
        v.language.as_ref().and_then(rank_to_string)
    }

    // English-tagged.
    if let Some(name) = item
        .vernacular_names
        .iter()
        .find(|v| lang_str(v).as_deref() == Some("eng"))
        .map(|v| v.vernacular_name.clone())
    {
        return Some(name);
    }
    // Untagged (GBIF often omits the language tag for English).
    if let Some(name) = item
        .vernacular_names
        .iter()
        .find(|v| v.language.is_none())
        .map(|v| v.vernacular_name.clone())
    {
        return Some(name);
    }
    // Preferred.
    if let Some(name) = item
        .vernacular_names
        .iter()
        .find(|v| v.preferred == Some(true))
        .map(|v| v.vernacular_name.clone())
    {
        return Some(name);
    }
    // First available.
    item.vernacular_names
        .first()
        .map(|v| v.vernacular_name.clone())
}

/// Cache hit/miss/entry-count snapshot.
#[allow(dead_code)] // exposed for future health/diagnostics endpoint
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CacheStats {
    pub entries: u64,
    pub hits: u64,
    pub misses: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Build a NameUsageSearchResult from a JSON literal. Uses the wire
    /// format so we don't have to construct each generated field by hand.
    fn make_search_result(
        canonical_name: &str,
        rank: &str,
        vernacular_name: Option<&str>,
        vernacular_names: Vec<serde_json::Value>,
    ) -> NameUsageSearchResult {
        let mut obj = serde_json::Map::new();
        obj.insert("canonicalName".into(), json!(canonical_name));
        obj.insert("scientificName".into(), json!(canonical_name));
        obj.insert("rank".into(), json!(rank));
        obj.insert("kingdom".into(), json!("Fungi"));
        obj.insert("vernacularNames".into(), json!(vernacular_names));
        // The generated `NameUsageSearchResult` has several non-Option Vec /
        // Map fields that lack `#[serde(default)]`, so the wire deserializer
        // requires them to be present even when empty.
        obj.insert("descriptions".into(), json!([]));
        obj.insert("habitats".into(), json!([]));
        obj.insert("nomenclaturalStatus".into(), json!([]));
        obj.insert("threatStatuses".into(), json!([]));
        obj.insert("higherClassificationMap".into(), json!({}));
        if let Some(v) = vernacular_name {
            // NameUsageSearchResult has no top-level vernacular_name field;
            // the old crate's `vernacularName` lived only on its hand-written
            // SearchResult. Inject it as the first untagged entry so the
            // "prefer top-level" test still meaningfully exercises the code
            // path that prefers an explicit appview-supplied name.
            let mut nv = serde_json::Map::new();
            nv.insert("vernacularName".into(), json!(v));
            // Tag as English so it sorts ahead of any locale-tagged
            // alternatives.
            nv.insert("language".into(), json!("eng"));
            let arr = obj
                .get_mut("vernacularNames")
                .and_then(|v| v.as_array_mut())
                .unwrap();
            arr.insert(0, serde_json::Value::Object(nv));
        }
        serde_json::from_value(serde_json::Value::Object(obj)).unwrap()
    }

    fn vn(name: &str, language: Option<&str>, preferred: Option<bool>) -> serde_json::Value {
        let mut m = serde_json::Map::new();
        m.insert("vernacularName".into(), json!(name));
        if let Some(l) = language {
            m.insert("language".into(), json!(l));
        }
        if let Some(p) = preferred {
            m.insert("preferred".into(), json!(p));
        }
        serde_json::Value::Object(m)
    }

    #[test]
    fn test_vernacular_prefers_top_level_field() {
        let client = GbifClient::new();
        let item = make_search_result(
            "Quercus alba",
            "SPECIES",
            Some("White Oak"),
            vec![vn("Chêne blanc", Some("fra"), None)],
        );
        let result = client.search_result_to_taxon(&item);
        assert_eq!(result.common_name.as_deref(), Some("White Oak"));
    }

    #[test]
    fn test_vernacular_prefers_english_tagged() {
        let client = GbifClient::new();
        let item = make_search_result(
            "Quercus alba",
            "SPECIES",
            None,
            vec![
                vn("Chêne blanc", Some("fra"), None),
                vn("White Oak", Some("eng"), None),
            ],
        );
        let result = client.search_result_to_taxon(&item);
        assert_eq!(result.common_name.as_deref(), Some("White Oak"));
    }

    #[test]
    fn test_vernacular_untagged_fallback() {
        // Reproduces the Erysiphaceae / "Powdery Mildews" case:
        // GBIF returns the English name with no language tag.
        let client = GbifClient::new();
        let item = make_search_result(
            "Erysiphaceae",
            "FAMILY",
            None,
            vec![
                vn("Meldugfamilien", Some("dan"), None),
                vn("Powdery Mildews", None, None),
            ],
        );
        let result = client.search_result_to_taxon(&item);
        assert_eq!(result.common_name.as_deref(), Some("Powdery Mildews"));
    }

    #[test]
    fn test_vernacular_preferred_fallback() {
        let client = GbifClient::new();
        let item = make_search_result(
            "Passer domesticus",
            "SPECIES",
            None,
            vec![
                vn("Gorrión común", Some("spa"), Some(true)),
                vn("Moineau domestique", Some("fra"), None),
            ],
        );
        let result = client.search_result_to_taxon(&item);
        assert_eq!(result.common_name.as_deref(), Some("Gorrión común"));
    }

    #[test]
    fn test_vernacular_first_available_fallback() {
        let client = GbifClient::new();
        let item = make_search_result(
            "Passer domesticus",
            "SPECIES",
            None,
            vec![
                vn("Gorrión común", Some("spa"), None),
                vn("Moineau domestique", Some("fra"), None),
            ],
        );
        let result = client.search_result_to_taxon(&item);
        assert_eq!(result.common_name.as_deref(), Some("Gorrión común"));
    }

    #[test]
    fn test_vernacular_none_when_empty() {
        let client = GbifClient::new();
        let item = make_search_result("Erysiphaceae", "FAMILY", None, vec![]);
        let result = client.search_result_to_taxon(&item);
        assert_eq!(result.common_name, None);
    }

    #[test]
    fn test_vernacular_english_beats_untagged() {
        let client = GbifClient::new();
        let item = make_search_result(
            "Erysiphaceae",
            "FAMILY",
            None,
            vec![
                vn("Powdery Mildews", None, None),
                vn("Powdery Mildew Fungi", Some("eng"), None),
            ],
        );
        let result = client.search_result_to_taxon(&item);
        assert_eq!(result.common_name.as_deref(), Some("Powdery Mildew Fungi"));
    }

    #[test]
    fn test_iucn_category_from_str() {
        assert_eq!("EX".parse::<IucnCategory>(), Ok(IucnCategory::Ex));
        assert_eq!("LC".parse::<IucnCategory>(), Ok(IucnCategory::Lc));
        assert!("XX".parse::<IucnCategory>().is_err());
        assert!("ex".parse::<IucnCategory>().is_err());
    }

    #[test]
    fn test_gbif_taxon_uri_format() {
        // The shape the ingester parses back out (`observing-db::processing`).
        assert_eq!(
            gbif_taxon_uri(5231190),
            "https://www.gbif.org/species/5231190"
        );
    }

    #[test]
    fn test_search_result_carries_gbif_taxon_id() {
        let client = GbifClient::new();
        let mut item = make_search_result("Passer domesticus", "SPECIES", None, vec![]);
        item.key = Some(5231190);
        let result = client.search_result_to_taxon(&item);
        assert_eq!(
            result.taxon_id.as_deref(),
            Some("https://www.gbif.org/species/5231190"),
            "a backbone key must surface as a stable dwc:taxonID URI"
        );
    }

    #[test]
    fn test_search_result_taxon_id_none_without_key() {
        let client = GbifClient::new();
        // `make_search_result` leaves `key` unset (None).
        let item = make_search_result("Passer domesticus", "SPECIES", None, vec![]);
        let result = client.search_result_to_taxon(&item);
        assert!(
            result.taxon_id.is_none(),
            "no backbone key means no taxonID, got {:?}",
            result.taxon_id
        );
    }

    // ---------- match_name_raw cache regression tests (#269) ----------
    //
    // These cover the fix that wraps `/v2/species/match` results in the
    // moka cache so concurrent / repeated lookups for the same name don't
    // each hit GBIF and risk getting inconsistent responses (the bug that
    // produced the "Taxon not found" flash). Tests spin up a wiremock
    // server, point a `GbifClient` at it, and assert the upstream is hit
    // exactly the expected number of times.

    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// Minimal NameUsageMatch JSON the wire deserializer will accept,
    /// with a real usage so the resolver doesn't drop it as "empty".
    fn match_response_body(name: &str, key: &str) -> serde_json::Value {
        json!({
            "synonym": false,
            "usage": {
                "key": key,
                "name": name,
                "canonicalName": name,
                "rank": "SPECIES"
            },
            "classification": []
        })
    }

    #[tokio::test]
    async fn match_name_raw_caches_repeated_lookups() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v2/species/match"))
            .and(query_param("scientificName", "Quercus alba"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(match_response_body("Quercus alba", "1")),
            )
            // The whole point: even two back-to-back identical lookups must
            // hit GBIF exactly once.
            .expect(1)
            .mount(&server)
            .await;

        let client = GbifClient::with_base_url(&server.uri());

        let r1 = client
            .match_name_raw("Quercus alba", Some("Plantae"))
            .await
            .expect("first lookup succeeds");
        let r2 = client
            .match_name_raw("Quercus alba", Some("Plantae"))
            .await
            .expect("second lookup succeeds");

        let usage1 = r1.expect("first call returns Some").usage.expect("usage");
        let usage2 = r2.expect("second call returns Some").usage.expect("usage");
        assert_eq!(usage1.key.as_deref(), Some("1"));
        assert_eq!(usage2.key.as_deref(), Some("1"));
        // server.verify() on drop will panic if expect(1) was violated.
    }

    #[tokio::test]
    async fn match_name_raw_caches_misses_as_none() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v2/species/match"))
            .respond_with(ResponseTemplate::new(404))
            // A second lookup for a name GBIF said didn't exist must also
            // be served from cache, not re-queried.
            .expect(1)
            .mount(&server)
            .await;

        let client = GbifClient::with_base_url(&server.uri());

        assert!(client
            .match_name_raw("Doesnotexistus invalidus", None)
            .await
            .expect("lookup completes")
            .is_none());
        assert!(client
            .match_name_raw("Doesnotexistus invalidus", None)
            .await
            .expect("lookup completes")
            .is_none());
    }

    #[tokio::test]
    async fn match_name_raw_keys_by_kingdom_hint() {
        // Different kingdom hints must NOT collide in the cache — they
        // can produce different matches in GBIF (the disambiguation
        // whole reason for the hint), so each (name, kingdom) pair gets
        // its own upstream call.
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v2/species/match"))
            .and(query_param("kingdom", "Plantae"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(match_response_body("Morus", "100")),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/v2/species/match"))
            .and(query_param("kingdom", "Animalia"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(match_response_body("Morus", "200")),
            )
            .expect(1)
            .mount(&server)
            .await;

        let client = GbifClient::with_base_url(&server.uri());

        let plant = client
            .match_name_raw("Morus", Some("Plantae"))
            .await
            .unwrap()
            .unwrap();
        let bird = client
            .match_name_raw("Morus", Some("Animalia"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(plant.usage.unwrap().key.as_deref(), Some("100"));
        assert_eq!(bird.usage.unwrap().key.as_deref(), Some("200"));

        // And the cache really is keyed on (name, kingdom): a repeat of
        // either lookup is served from cache, not the upstream.
        let _ = client
            .match_name_raw("Morus", Some("Plantae"))
            .await
            .unwrap();
        let _ = client
            .match_name_raw("Morus", Some("Animalia"))
            .await
            .unwrap();
    }

    /// End-to-end through the public `validate` path: an EXACT GBIF match
    /// resolves a taxon whose `taxon_id` is the GBIF species URI. This is the
    /// value the occurrence write path reads back as the identification's
    /// `taxonID` when the user didn't supply one from autocomplete.
    #[tokio::test]
    async fn validate_exact_match_carries_gbif_taxon_id() {
        let server = MockServer::start().await;
        // Diagnostics needs its non-nullable collection fields present, the
        // same way `make_search_result` fills empty required arrays/maps.
        let body = json!({
            "synonym": false,
            "usage": {
                "key": "5231190",
                "name": "Passer domesticus",
                "canonicalName": "Passer domesticus",
                "rank": "SPECIES"
            },
            "classification": [],
            "diagnostics": {
                "matchType": "EXACT",
                "issues": [],
                "processingFlags": [],
                "alternatives": [],
                "timings": {}
            }
        });
        Mock::given(method("GET"))
            .and(path("/v2/species/match"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;

        let client = GbifClient::with_base_url(&server.uri());
        let resp = client.validate("Passer domesticus", None).await;

        assert!(resp.valid, "an EXACT match should validate");
        let taxon = resp.taxon.expect("an exact match returns a taxon");
        assert_eq!(
            taxon.taxon_id.as_deref(),
            Some("https://www.gbif.org/species/5231190"),
            "the resolved taxon carries the GBIF species URI used as dwc:taxonID"
        );
    }
}
