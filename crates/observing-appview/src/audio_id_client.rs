use reqwest::Client;
use std::time::Duration;

pub use observing_audio_id_protocol::{IdentifyRequest, IdentifyResponse};

/// HTTP client for the bioacoustic identification service.
///
/// Mirrors `SpeciesIdClient` — same shape, longer default timeout because
/// audio inference on Perch is meaningfully slower than BioCLIP image
/// inference (a 30s clip = 11 frames, each a full forward pass).
pub struct AudioIdClient {
    client: Client,
    base_url: String,
}

impl AudioIdClient {
    pub fn new(base_url: &str) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .expect("Failed to create HTTP client");
        Self {
            client,
            base_url: base_url.to_string(),
        }
    }

    pub async fn identify(
        &self,
        audio_base64: &str,
        latitude: Option<f64>,
        longitude: Option<f64>,
        limit: Option<usize>,
    ) -> Result<IdentifyResponse, reqwest::Error> {
        let url = format!("{}/identify", self.base_url);
        let body = IdentifyRequest {
            audio: audio_base64.to_string(),
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
