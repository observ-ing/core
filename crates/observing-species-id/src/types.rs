//! Data types for species identification service

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyRequest {
    /// Base64-encoded image data
    pub image: String,
    /// Optional latitude for geo-prior reranking
    #[serde(default)]
    pub latitude: Option<f64>,
    /// Optional longitude for geo-prior reranking
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
#[serde(rename_all = "camelCase")]
pub struct IdentifyResponse {
    pub suggestions: Vec<SpeciesSuggestion>,
    pub model_version: String,
    pub inference_time_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesSuggestion {
    pub scientific_name: String,
    pub confidence: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub common_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kingdom: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phylum: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genus: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub uptime_secs: u64,
    pub model_version: String,
    pub species_count: usize,
}
