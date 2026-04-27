use reqwest::Client;
use std::time::Duration;

pub use observing_species_id_protocol::{IdentifyRequest, IdentifyResponse};

/// HTTP client for the species identification service
pub struct SpeciesIdClient {
    client: Client,
    base_url: String,
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

        let body = IdentifyRequest {
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
