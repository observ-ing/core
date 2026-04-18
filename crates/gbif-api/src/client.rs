//! GBIF API HTTP client

use crate::error::Result;
use crate::types::*;
use std::sync::LazyLock;
use std::time::Duration;

// Endpoint URLs parsed once at first use. Using LazyLock<Url> keeps the
// `Url::parse` failure mode out of every request path — if the literal is
// malformed the process panics the first time the endpoint is touched,
// which is caught by any test that exercises the client.
static V1_SPECIES_SUGGEST_URL: LazyLock<reqwest::Url> = LazyLock::new(|| {
    reqwest::Url::parse(&format!("{}/species/suggest", GbifClient::V1_BASE_URL))
        .expect("V1_BASE_URL + /species/suggest must be a valid URL")
});
static V1_SPECIES_SEARCH_URL: LazyLock<reqwest::Url> = LazyLock::new(|| {
    reqwest::Url::parse(&format!("{}/species/search", GbifClient::V1_BASE_URL))
        .expect("V1_BASE_URL + /species/search must be a valid URL")
});
static V2_SPECIES_MATCH_URL: LazyLock<reqwest::Url> = LazyLock::new(|| {
    reqwest::Url::parse(&format!("{}/species/match", GbifClient::V2_BASE_URL))
        .expect("V2_BASE_URL + /species/match must be a valid URL")
});

/// Client for interacting with the GBIF (Global Biodiversity Information Facility) API
///
/// Provides access to GBIF's species, taxonomy, and biodiversity data through
/// both v1 and v2 API endpoints.
pub struct GbifClient {
    http: reqwest::Client,
}

impl GbifClient {
    /// Base URL for GBIF API v1
    pub const V1_BASE_URL: &'static str = "https://api.gbif.org/v1";
    /// Base URL for GBIF API v2
    pub const V2_BASE_URL: &'static str = "https://api.gbif.org/v2";

    /// Create a new GBIF client with default settings (30 second timeout)
    pub fn new() -> Self {
        Self::with_timeout(Duration::from_secs(30))
    }

    /// Create a new GBIF client with a custom timeout
    pub fn with_timeout(timeout: Duration) -> Self {
        let http = reqwest::Client::builder()
            .timeout(timeout)
            .build()
            .expect("Failed to create HTTP client");

        Self { http }
    }

    /// Search for species using the suggest endpoint
    ///
    /// Returns taxa matching the query string, useful for autocomplete functionality.
    /// Note: This endpoint primarily matches scientific names.
    ///
    /// # Arguments
    /// * `query` - Search string to match against scientific and vernacular names
    /// * `limit` - Maximum number of results to return
    /// * `status` - Optional taxonomic status filter (e.g., "ACCEPTED", "SYNONYM")
    pub async fn suggest(
        &self,
        query: &str,
        limit: u32,
        status: Option<&str>,
    ) -> Result<Vec<SuggestResult>> {
        let mut url = V1_SPECIES_SUGGEST_URL.clone();
        {
            let mut params = url.query_pairs_mut();
            params.append_pair("q", query);
            params.append_pair("limit", &limit.to_string());
            if let Some(s) = status {
                params.append_pair("status", s);
            }
        }

        let response = self.http.get(url).send().await?;

        if !response.status().is_success() {
            return Ok(vec![]);
        }

        Ok(response.json().await?)
    }

    /// GBIF Backbone Taxonomy dataset key
    pub const BACKBONE_DATASET_KEY: &'static str = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c";

    /// Search for species using the full-text search endpoint
    ///
    /// This endpoint searches across both scientific names and vernacular names,
    /// providing better results for common name searches.
    ///
    /// When `backbone_only` is true, searches only the GBIF Backbone Taxonomy,
    /// which provides authoritative taxonomic status (accepted vs synonym).
    ///
    /// # Arguments
    /// * `query` - Search string to match against scientific and vernacular names
    /// * `limit` - Maximum number of results to return
    /// * `status` - Optional taxonomic status filter (e.g., "ACCEPTED", "SYNONYM")
    /// * `backbone_only` - If true, search only the GBIF Backbone Taxonomy
    pub async fn search(
        &self,
        query: &str,
        limit: u32,
        status: Option<&str>,
        backbone_only: bool,
    ) -> Result<Vec<SearchResult>> {
        let mut url = V1_SPECIES_SEARCH_URL.clone();
        {
            let mut params = url.query_pairs_mut();
            params.append_pair("q", query);
            params.append_pair("limit", &limit.to_string());
            if let Some(s) = status {
                params.append_pair("status", s);
            }
            if backbone_only {
                params.append_pair("datasetKey", Self::BACKBONE_DATASET_KEY);
            }
        }

        let response = self.http.get(url).send().await?;

        if !response.status().is_success() {
            return Ok(vec![]);
        }

        let data: ListResponse<SearchResult> = response.json().await?;
        Ok(data.results)
    }

    /// Get detailed species information by GBIF key
    ///
    /// # Arguments
    /// * `key` - The GBIF species key (numeric ID)
    pub async fn get_species(&self, key: u64) -> Result<Option<SpeciesDetail>> {
        let url = format!("{}/species/{}", Self::V1_BASE_URL, key);
        let response = self.http.get(&url).send().await?;

        if !response.status().is_success() {
            return Ok(None);
        }

        Ok(Some(response.json().await?))
    }

    /// Match a scientific name against the GBIF backbone taxonomy (v2 API)
    ///
    /// This is the preferred method for name matching as it includes
    /// IUCN conservation status and classification hierarchy.
    ///
    /// # Arguments
    /// * `name` - Scientific name to match
    /// * `kingdom` - Optional kingdom filter for disambiguation
    pub async fn match_name(
        &self,
        name: &str,
        kingdom: Option<&str>,
    ) -> Result<Option<V2MatchResult>> {
        let mut url = V2_SPECIES_MATCH_URL.clone();
        {
            let mut params = url.query_pairs_mut();
            params.append_pair("scientificName", name);
            if let Some(k) = kingdom {
                params.append_pair("kingdom", k);
            }
        }

        let response = self.http.get(url).send().await?;

        if !response.status().is_success() {
            return Ok(None);
        }

        let data: V2MatchResult = response.json().await?;
        if data.usage.is_none() {
            return Ok(None);
        }
        Ok(Some(data))
    }

    /// Get child taxa for a parent taxon
    ///
    /// # Arguments
    /// * `parent_key` - The GBIF key of the parent taxon
    /// * `limit` - Maximum number of children to return
    pub async fn get_children(&self, parent_key: u64, limit: u32) -> Result<Vec<SuggestResult>> {
        let url = format!(
            "{}/species/{}/children?limit={}",
            Self::V1_BASE_URL,
            parent_key,
            limit
        );
        let response = self.http.get(&url).send().await?;

        if !response.status().is_success() {
            return Ok(vec![]);
        }

        let data: ListResponse<SuggestResult> = response.json().await?;
        Ok(data.results)
    }

    /// Get descriptions for a taxon
    ///
    /// # Arguments
    /// * `key` - The GBIF species key
    /// * `limit` - Maximum number of descriptions to return
    pub async fn get_descriptions(&self, key: u64, limit: u32) -> Result<Vec<Description>> {
        let url = format!(
            "{}/species/{}/descriptions?limit={}",
            Self::V1_BASE_URL,
            key,
            limit
        );
        let response = self.http.get(&url).send().await?;

        if !response.status().is_success() {
            return Ok(vec![]);
        }

        let data: ListResponse<Description> = response.json().await?;
        Ok(data.results)
    }

    /// Get references/citations for a taxon
    ///
    /// # Arguments
    /// * `key` - The GBIF species key
    /// * `limit` - Maximum number of references to return
    pub async fn get_references(&self, key: u64, limit: u32) -> Result<Vec<Reference>> {
        let url = format!(
            "{}/species/{}/references?limit={}",
            Self::V1_BASE_URL,
            key,
            limit
        );
        let response = self.http.get(&url).send().await?;

        if !response.status().is_success() {
            return Ok(vec![]);
        }

        let data: ListResponse<Reference> = response.json().await?;
        Ok(data.results)
    }

    /// Get media items (images, etc.) for a taxon
    ///
    /// # Arguments
    /// * `key` - The GBIF species key
    /// * `limit` - Maximum number of media items to return
    pub async fn get_media(&self, key: u64, limit: u32) -> Result<Vec<Media>> {
        let url = format!(
            "{}/species/{}/media?limit={}",
            Self::V1_BASE_URL,
            key,
            limit
        );
        let response = self.http.get(&url).send().await?;

        if !response.status().is_success() {
            return Ok(vec![]);
        }

        let data: ListResponse<Media> = response.json().await?;
        Ok(data.results)
    }

    /// Extract IUCN conservation status from a v2 match result
    ///
    /// # Arguments
    /// * `match_result` - A v2 match result containing additional status information
    pub fn extract_iucn_status(match_result: &V2MatchResult) -> Option<IucnCategory> {
        match_result
            .additional_status
            .as_ref()?
            .iter()
            .find(|s| s.dataset_alias.as_deref() == Some("IUCN"))?
            .status_code
            .as_deref()?
            .parse()
            .ok()
    }
}

impl Default for GbifClient {
    fn default() -> Self {
        Self::new()
    }
}
