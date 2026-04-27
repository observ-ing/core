//! Data types for species identification service.
//!
//! The wire types shared with the appview client live in the
//! `observing-species-id-protocol` crate — re-exported here so existing
//! `crate::types::{SpeciesSuggestion, IdentifyResponse}` imports keep working.

use serde::{Deserialize, Serialize};

pub use observing_species_id_protocol::{IdentifyResponse, SpeciesSuggestion};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyRequest {
    /// Base64-encoded image data
    pub image: String,
    /// Latitude for geo-prior reranking (reserved for future use)
    #[serde(default)]
    pub latitude: Option<f64>,
    /// Longitude for geo-prior reranking (reserved for future use)
    #[serde(default)]
    pub longitude: Option<f64>,
    /// Number of suggestions to return (default: 5)
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    5
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub uptime_secs: u64,
    pub model_version: String,
    pub species_count: usize,
}
