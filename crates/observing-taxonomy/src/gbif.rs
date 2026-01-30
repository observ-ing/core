//! GBIF API client for taxonomy lookups

use crate::error::Result;
use crate::types::*;
use moka::future::Cache;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tracing::warn;

/// Build a path-based taxon identifier: "{kingdom}/{name}" or just "{name}" for kingdom rank
fn build_taxon_path(scientific_name: &str, rank: &str, kingdom: Option<&str>) -> String {
    let lower_rank = rank.to_lowercase();
    if lower_rank == "kingdom" {
        return scientific_name.to_string();
    }
    if let Some(k) = kingdom {
        format!("{}/{}", k, scientific_name)
    } else {
        scientific_name.to_string()
    }
}

/// GBIF API client with caching
pub struct GbifClient {
    http: reqwest::Client,
    cache: Cache<String, CachedValue>,
    hits: AtomicU64,
    misses: AtomicU64,
}

#[derive(Clone)]
enum CachedValue {
    SearchResults(Vec<TaxonResult>),
    TaxonDetail(Box<TaxonDetail>),
    Children(Vec<TaxonResult>),
}

impl GbifClient {
    const V1_BASE_URL: &'static str = "https://api.gbif.org/v1";
    const V2_BASE_URL: &'static str = "https://api.gbif.org/v2";
    const CACHE_TTL_MINS: u64 = 30;

    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        let cache = Cache::builder()
            .max_capacity(10_000)
            .time_to_live(Duration::from_secs(Self::CACHE_TTL_MINS * 60))
            .build();

        Self {
            http,
            cache,
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
        }
    }

    pub fn cache_stats(&self) -> CacheStats {
        CacheStats {
            entries: self.cache.entry_count(),
            hits: self.hits.load(Ordering::Relaxed),
            misses: self.misses.load(Ordering::Relaxed),
        }
    }

    /// Search for taxa matching a query
    pub async fn search(&self, query: &str, limit: u32) -> Result<Vec<TaxonResult>> {
        let cache_key = format!("search:{}:{}", query.to_lowercase(), limit);

        if let Some(CachedValue::SearchResults(results)) = self.cache.get(&cache_key).await {
            self.hits.fetch_add(1, Ordering::Relaxed);
            return Ok(results);
        }
        self.misses.fetch_add(1, Ordering::Relaxed);

        let results = self.search_gbif(query, limit).await?;
        self.cache
            .insert(cache_key, CachedValue::SearchResults(results.clone()))
            .await;
        Ok(results)
    }

    /// Validate a scientific name
    pub async fn validate(&self, name: &str) -> Result<ValidationResult> {
        let gbif_match = match self.match_gbif(name).await? {
            Some(m) => m,
            None => {
                return Ok(ValidationResult {
                    valid: false,
                    matched_name: None,
                    taxon: None,
                    suggestions: Some(vec![]),
                })
            }
        };

        let usage = match &gbif_match.usage {
            Some(u) => u,
            None => {
                return Ok(ValidationResult {
                    valid: false,
                    matched_name: None,
                    taxon: None,
                    suggestions: Some(vec![]),
                })
            }
        };

        let match_type = gbif_match
            .diagnostics
            .as_ref()
            .and_then(|d| d.match_type.as_deref());
        let taxon = self.gbif_v2_to_taxon(
            usage,
            gbif_match.additional_status.as_deref(),
            gbif_match.classification.as_deref(),
        );

        if match_type == Some("EXACT") {
            Ok(ValidationResult {
                valid: true,
                matched_name: usage.canonical_name.clone().or_else(|| usage.name.clone()),
                taxon: Some(taxon),
                suggestions: None,
            })
        } else {
            Ok(ValidationResult {
                valid: false,
                matched_name: None,
                taxon: None,
                suggestions: Some(vec![taxon]),
            })
        }
    }

    /// Get detailed taxon information by GBIF ID
    pub async fn get_by_id(&self, taxon_id: &str) -> Result<Option<TaxonDetail>> {
        let numeric_id = taxon_id.strip_prefix("gbif:").unwrap_or(taxon_id);
        let cache_key = format!("detail:{}", numeric_id);

        if let Some(CachedValue::TaxonDetail(detail)) = self.cache.get(&cache_key).await {
            self.hits.fetch_add(1, Ordering::Relaxed);
            return Ok(Some(*detail));
        }
        self.misses.fetch_add(1, Ordering::Relaxed);

        let url = format!("{}/species/{}", Self::V1_BASE_URL, numeric_id);
        let response = self.http.get(&url).send().await?;

        if !response.status().is_success() {
            return Ok(None);
        }

        let data: GbifSpeciesDetail = response.json().await?;

        // Fetch children, descriptions, references, and media in parallel
        let (children, descriptions, references, media) = tokio::join!(
            self.get_children(taxon_id, 20),
            self.get_descriptions(numeric_id),
            self.get_references(numeric_id),
            self.get_media(numeric_id),
        );

        let children = children.unwrap_or_default();
        let descriptions = descriptions.unwrap_or_default();
        let references = references.unwrap_or_default();
        let media = media.unwrap_or_default();

        // Build ancestors from individual key fields
        let mut ancestors = Vec::new();
        let rank_fields = [
            ("kingdom", data.kingdom_key, data.kingdom.as_deref()),
            ("phylum", data.phylum_key, data.phylum.as_deref()),
            ("class", data.class_key, data.class.as_deref()),
            ("order", data.order_key, data.order.as_deref()),
            ("family", data.family_key, data.family.as_deref()),
            ("genus", data.genus_key, data.genus.as_deref()),
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

        // Get conservation status
        let conservation_status = if let Some(canonical) = &data.canonical_name {
            self.get_conservation_status(canonical).await
        } else if let Some(scientific) = &data.scientific_name {
            self.get_conservation_status(scientific).await
        } else {
            None
        };

        let resolved_name = data
            .canonical_name
            .as_deref()
            .or(data.scientific_name.as_deref())
            .unwrap_or("");
        let resolved_rank = data
            .rank
            .as_deref()
            .map(|r| r.to_lowercase())
            .unwrap_or_else(|| "unknown".to_string());

        let taxon_detail = TaxonDetail {
            base: TaxonResult {
                id: build_taxon_path(resolved_name, &resolved_rank, data.kingdom.as_deref()),
                scientific_name: resolved_name.to_string(),
                common_name: data.vernacular_name,
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
            },
            ancestors,
            children,
            num_descendants: data.num_descendants,
            extinct: data.extinct,
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
            gbif_url: data.key.map(|k| format!("https://www.gbif.org/species/{}", k)),
        };

        self.cache
            .insert(
                cache_key,
                CachedValue::TaxonDetail(Box::new(taxon_detail.clone())),
            )
            .await;
        Ok(Some(taxon_detail))
    }

    /// Get detailed taxon information by scientific name
    pub async fn get_by_name(
        &self,
        scientific_name: &str,
        kingdom: Option<&str>,
    ) -> Result<Option<TaxonDetail>> {
        let mut url = format!(
            "{}/species/match?scientificName={}",
            Self::V2_BASE_URL,
            urlencoding::encode(scientific_name)
        );
        if let Some(k) = kingdom {
            url.push_str(&format!("&kingdom={}", urlencoding::encode(k)));
        }

        let response = self.http.get(&url).send().await?;
        if !response.status().is_success() {
            return Ok(None);
        }

        let data: GbifV2MatchResult = response.json().await?;
        let usage_key = data.usage.as_ref().and_then(|u| u.key);

        if let Some(key) = usage_key {
            self.get_by_id(&format!("gbif:{}", key)).await
        } else {
            Ok(None)
        }
    }

    /// Get children taxa for a parent taxon
    pub async fn get_children(&self, taxon_id: &str, limit: u32) -> Result<Vec<TaxonResult>> {
        let numeric_id = taxon_id.strip_prefix("gbif:").unwrap_or(taxon_id);
        let cache_key = format!("children:{}:{}", numeric_id, limit);

        if let Some(CachedValue::Children(results)) = self.cache.get(&cache_key).await {
            self.hits.fetch_add(1, Ordering::Relaxed);
            return Ok(results);
        }
        self.misses.fetch_add(1, Ordering::Relaxed);

        let url = format!(
            "{}/species/{}/children?limit={}",
            Self::V1_BASE_URL,
            numeric_id,
            limit
        );
        let response = self.http.get(&url).send().await?;

        if !response.status().is_success() {
            return Ok(vec![]);
        }

        let data: GbifListResponse<GbifSuggestResult> = response.json().await?;
        let results: Vec<TaxonResult> = data.results.iter().map(|item| self.gbif_to_taxon(item)).collect();

        self.cache
            .insert(cache_key, CachedValue::Children(results.clone()))
            .await;
        Ok(results)
    }

    /// Get conservation status for a taxon by matching its name
    async fn get_conservation_status(&self, name: &str) -> Option<ConservationStatus> {
        let gbif_match = self.match_gbif(name).await.ok()??;
        let iucn_status = gbif_match.additional_status.as_ref()?.iter().find(|s| {
            s.dataset_alias
                .as_ref()
                .map(|a| a == "IUCN")
                .unwrap_or(false)
        })?;

        let category = IucnCategory::from_str(iucn_status.status_code.as_deref()?)?;
        Some(ConservationStatus {
            category,
            source: "IUCN".to_string(),
        })
    }

    /// Get descriptions for a taxon
    async fn get_descriptions(&self, numeric_id: &str) -> Result<Vec<TaxonDescription>> {
        let url = format!(
            "{}/species/{}/descriptions?limit=5",
            Self::V1_BASE_URL,
            numeric_id
        );
        let response = self.http.get(&url).send().await?;

        if !response.status().is_success() {
            return Ok(vec![]);
        }

        let data: GbifListResponse<GbifDescription> = response.json().await?;
        Ok(data
            .results
            .into_iter()
            .filter_map(|d| {
                d.description.map(|desc| TaxonDescription {
                    description: desc,
                    r#type: d.r#type,
                    source: d.source,
                })
            })
            .collect())
    }

    /// Get references for a taxon
    async fn get_references(&self, numeric_id: &str) -> Result<Vec<TaxonReference>> {
        let url = format!(
            "{}/species/{}/references?limit=10",
            Self::V1_BASE_URL,
            numeric_id
        );
        let response = self.http.get(&url).send().await?;

        if !response.status().is_success() {
            return Ok(vec![]);
        }

        let data: GbifListResponse<GbifReference> = response.json().await?;
        Ok(data
            .results
            .into_iter()
            .filter_map(|r| {
                r.citation.map(|citation| TaxonReference {
                    citation,
                    doi: r.doi,
                    link: r.link,
                })
            })
            .collect())
    }

    /// Get media for a taxon
    async fn get_media(&self, numeric_id: &str) -> Result<Vec<TaxonMedia>> {
        let url = format!(
            "{}/species/{}/media?limit=10",
            Self::V1_BASE_URL,
            numeric_id
        );
        let response = self.http.get(&url).send().await?;

        if !response.status().is_success() {
            return Ok(vec![]);
        }

        let data: GbifListResponse<GbifMedia> = response.json().await?;
        Ok(data
            .results
            .into_iter()
            .filter_map(|m| {
                m.identifier.map(|url| TaxonMedia {
                    r#type: m.r#type.unwrap_or_else(|| "StillImage".to_string()),
                    url,
                    title: m.title,
                    description: m.description,
                    source: m.source,
                    creator: m.creator,
                    license: m.license,
                })
            })
            .collect())
    }

    /// Search GBIF species API and enrich with conservation status
    async fn search_gbif(&self, query: &str, limit: u32) -> Result<Vec<TaxonResult>> {
        let url = format!(
            "{}/species/suggest?q={}&limit={}&status=ACCEPTED",
            Self::V1_BASE_URL,
            urlencoding::encode(query),
            limit
        );
        let response = self.http.get(&url).send().await?;

        if !response.status().is_success() {
            warn!(query = %query, status = ?response.status(), "GBIF search failed");
            return Ok(vec![]);
        }

        let data: Vec<GbifSuggestResult> = response.json().await?;
        let basic_results: Vec<TaxonResult> = data.iter().map(|item| self.gbif_to_taxon(item)).collect();

        // Enrich with conservation status in parallel
        let enriched_futures = basic_results.into_iter().map(|result| async {
            let conservation_status = self.get_conservation_status(&result.scientific_name).await;
            TaxonResult {
                conservation_status,
                ..result
            }
        });

        Ok(futures::future::join_all(enriched_futures).await)
    }

    /// Match a name against GBIF backbone taxonomy (v2 API)
    async fn match_gbif(&self, name: &str) -> Result<Option<GbifV2MatchResult>> {
        let url = format!(
            "{}/species/match?scientificName={}",
            Self::V2_BASE_URL,
            urlencoding::encode(name)
        );
        let response = self.http.get(&url).send().await?;

        if !response.status().is_success() {
            return Ok(None);
        }

        let data: GbifV2MatchResult = response.json().await?;
        if data.usage.is_none() {
            return Ok(None);
        }
        Ok(Some(data))
    }

    /// Convert GBIF v1 result to TaxonResult
    fn gbif_to_taxon(&self, item: &GbifSuggestResult) -> TaxonResult {
        let name = item
            .canonical_name
            .as_deref()
            .or(item.scientific_name.as_deref())
            .unwrap_or("");
        let rank = item
            .rank
            .as_deref()
            .map(|r| r.to_lowercase())
            .unwrap_or_else(|| "unknown".to_string());

        TaxonResult {
            id: build_taxon_path(name, &rank, item.kingdom.as_deref()),
            scientific_name: name.to_string(),
            common_name: item.vernacular_name.clone(),
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

    /// Convert GBIF v2 result to TaxonResult
    fn gbif_v2_to_taxon(
        &self,
        usage: &GbifV2NameUsage,
        additional_status: Option<&[GbifV2AdditionalStatus]>,
        classification: Option<&[GbifV2NameUsage]>,
    ) -> TaxonResult {
        // Extract IUCN conservation status if available
        let conservation_status = additional_status.and_then(|statuses| {
            statuses.iter().find_map(|s| {
                if s.dataset_alias.as_ref().map(|a| a == "IUCN").unwrap_or(false) {
                    s.status_code
                        .as_ref()
                        .and_then(|code| IucnCategory::from_str(code))
                        .map(|category| ConservationStatus {
                            category,
                            source: "IUCN".to_string(),
                        })
                } else {
                    None
                }
            })
        });

        // Extract taxonomy from classification array
        let mut classification_by_rank = std::collections::HashMap::new();
        if let Some(classes) = classification {
            for item in classes {
                if let (Some(rank), Some(name)) = (&item.rank, &item.name) {
                    classification_by_rank.insert(rank.to_uppercase(), name.clone());
                }
            }
        }

        let resolved_name = usage
            .canonical_name
            .as_deref()
            .or(usage.name.as_deref())
            .unwrap_or("");
        let resolved_rank = usage
            .rank
            .as_deref()
            .map(|r| r.to_lowercase())
            .unwrap_or_else(|| "unknown".to_string());
        let resolved_kingdom = classification_by_rank
            .get("KINGDOM")
            .cloned()
            .or_else(|| usage.kingdom.clone());

        TaxonResult {
            id: build_taxon_path(resolved_name, &resolved_rank, resolved_kingdom.as_deref()),
            scientific_name: resolved_name.to_string(),
            common_name: None,
            rank: resolved_rank,
            kingdom: resolved_kingdom,
            phylum: classification_by_rank
                .get("PHYLUM")
                .cloned()
                .or_else(|| usage.phylum.clone()),
            class: classification_by_rank
                .get("CLASS")
                .cloned()
                .or_else(|| usage.class.clone()),
            order: classification_by_rank
                .get("ORDER")
                .cloned()
                .or_else(|| usage.order.clone()),
            family: classification_by_rank
                .get("FAMILY")
                .cloned()
                .or_else(|| usage.family.clone()),
            genus: classification_by_rank
                .get("GENUS")
                .cloned()
                .or_else(|| usage.genus.clone()),
            species: classification_by_rank
                .get("SPECIES")
                .cloned()
                .or_else(|| usage.species.clone()),
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
