use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::error;

/// HTTP client for the taxonomy Rust service
pub struct TaxonomyClient {
    client: Client,
    base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxonResult {
    pub id: String,
    pub scientific_name: String,
    pub common_name: Option<String>,
    pub photo_url: Option<String>,
    pub rank: String,
    pub kingdom: Option<String>,
    pub phylum: Option<String>,
    pub class: Option<String>,
    pub order: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
    pub species: Option<String>,
    pub source: String,
    pub conservation_status: Option<ConservationStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConservationStatus {
    pub category: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxonDetail {
    pub id: String,
    pub scientific_name: String,
    pub common_name: Option<String>,
    pub photo_url: Option<String>,
    pub rank: String,
    pub kingdom: Option<String>,
    pub phylum: Option<String>,
    pub class: Option<String>,
    pub order: Option<String>,
    pub family: Option<String>,
    pub genus: Option<String>,
    pub species: Option<String>,
    pub source: String,
    pub conservation_status: Option<ConservationStatus>,
    pub description: Option<String>,
    pub wikidata_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SearchResponse {
    pub results: Vec<TaxonResult>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateResponse {
    pub valid: bool,
    #[serde(rename = "matchedName")]
    pub matched_name: Option<String>,
    pub taxon: Option<TaxonResult>,
    pub suggestions: Option<Vec<TaxonResult>>,
}

impl TaxonomyClient {
    pub fn new(base_url: &str) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: base_url.to_string(),
        }
    }

    /// Search taxa by name
    pub async fn search(&self, query: &str, limit: Option<u32>) -> Option<Vec<TaxonResult>> {
        let limit = limit.unwrap_or(10);
        let url = format!("{}/search?q={}&limit={}", self.base_url, query, limit);

        match self.client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                // The taxonomy service returns a raw array, not wrapped in { results: [...] }
                resp.json::<Vec<TaxonResult>>().await.ok()
            }
            Ok(resp) => {
                error!(status = %resp.status(), "Taxonomy search failed");
                None
            }
            Err(e) => {
                error!(error = %e, "Taxonomy search request failed");
                None
            }
        }
    }

    /// Validate a taxon name
    pub async fn validate(&self, name: &str) -> Option<ValidateResponse> {
        let url = format!("{}/validate?name={}", self.base_url, name);

        match self.client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => resp.json().await.ok(),
            _ => None,
        }
    }

    /// Get taxon by GBIF ID or name
    pub async fn get_by_id(&self, id: &str) -> Option<TaxonDetail> {
        let url = format!("{}/taxon/{}", self.base_url, id);

        match self.client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => resp.json().await.ok(),
            _ => None,
        }
    }

    /// Get taxon by name with optional kingdom
    pub async fn get_by_name(&self, name: &str, kingdom: Option<&str>) -> Option<TaxonDetail> {
        let mut url = format!("{}/taxon/{}", self.base_url, name);
        if let Some(k) = kingdom {
            url.push_str(&format!("?kingdom={}", k));
        }

        match self.client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => resp.json().await.ok(),
            _ => None,
        }
    }
}
