use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::error;
use ts_rs::TS;

/// HTTP client for the species identification service
pub struct SpeciesIdClient {
    client: Client,
    base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct SpeciesSuggestion {
    pub scientific_name: String,
    pub confidence: f32,
    #[ts(optional)]
    pub common_name: Option<String>,
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyResponse {
    pub suggestions: Vec<SpeciesSuggestion>,
    pub model_version: String,
    pub inference_time_ms: u64,
}

impl SpeciesIdClient {
    pub fn new(base_url: &str) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: base_url.to_string(),
        }
    }

    /// Identify species from a base64-encoded image
    pub async fn identify(
        &self,
        image_base64: &str,
        latitude: Option<f64>,
        longitude: Option<f64>,
        limit: Option<usize>,
    ) -> Option<IdentifyResponse> {
        let url = format!("{}/identify", self.base_url);

        let body = serde_json::json!({
            "image": image_base64,
            "latitude": latitude,
            "longitude": longitude,
            "limit": limit.unwrap_or(5),
        });

        match self.client.post(&url).json(&body).send().await {
            Ok(resp) if resp.status().is_success() => resp.json().await.ok(),
            Ok(resp) => {
                error!(status = %resp.status(), "Species identification request failed");
                None
            }
            Err(e) => {
                error!(error = %e, "Species identification request failed");
                None
            }
        }
    }
}
