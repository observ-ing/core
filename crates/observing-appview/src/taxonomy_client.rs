use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tracing::error;
use ts_rs::TS;

/// HTTP client for the taxonomy Rust service
pub struct TaxonomyClient {
    client: Client,
    base_url: String,
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

    /// Get taxon by GBIF ID or name (raw JSON)
    pub async fn get_by_id_raw(&self, id: &str) -> Option<Value> {
        let url = format!("{}/taxon/{}", self.base_url, urlencoding::encode(id));

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

    /// Get taxon by name with optional kingdom.
    /// Returns the raw JSON Value so all fields (ancestors, children, descriptions, etc.) are preserved.
    pub async fn get_by_name_raw(&self, name: &str, kingdom: Option<&str>) -> Option<Value> {
        let encoded_name = urlencoding::encode(name);
        let mut url = format!("{}/taxon/{}", self.base_url, encoded_name);
        if let Some(k) = kingdom {
            url.push_str(&format!("?kingdom={}", k));
        }

        match self.client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => resp.json().await.ok(),
            _ => None,
        }
    }

    /// Get taxon by name with optional kingdom (typed).
    pub async fn get_by_name(&self, name: &str, kingdom: Option<&str>) -> Option<TaxonDetail> {
        let encoded_name = urlencoding::encode(name);
        let mut url = format!("{}/taxon/{}", self.base_url, encoded_name);
        if let Some(k) = kingdom {
            url.push_str(&format!("?kingdom={}", k));
        }

        match self.client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => resp.json().await.ok(),
            _ => None,
        }
    }
}
