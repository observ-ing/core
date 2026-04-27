use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
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
    /// Used by the frontend for the taxon link target and passed to GBIF
    /// match_name as a disambiguator when filling in missing common names.
    #[ts(optional)]
    pub kingdom: Option<String>,
    /// Whether this species' iNat range covers the request lat/lon.
    /// Absent when no opinion was formed (no coordinates, no geo index,
    /// or the H3 cell at the request point is unknown to the index).
    #[ts(optional)]
    pub in_range: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentifyRequestBody {
    image: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
    limit: usize,
}

#[derive(Debug, Serialize, Deserialize)]
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

    /// Identify species from a base64-encoded image.
    ///
    /// Errors are propagated to the caller (network failure, non-2xx status
    /// from the upstream service, or JSON decode failure) so the route can
    /// log them with full context instead of collapsing everything into a
    /// generic `None`.
    pub async fn identify(
        &self,
        image_base64: &str,
        latitude: Option<f64>,
        longitude: Option<f64>,
        limit: Option<usize>,
    ) -> Result<IdentifyResponse, reqwest::Error> {
        let url = format!("{}/identify", self.base_url);

        let body = IdentifyRequestBody {
            image: image_base64.to_string(),
            latitude,
            longitude,
            limit: limit.unwrap_or(5),
        };

        self.client
            .post(&url)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
    }
}
