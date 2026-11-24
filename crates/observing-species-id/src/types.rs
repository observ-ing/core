//! Data types for species identification service.
//!
//! The wire types shared with the appview client live in the
//! `observing-species-id-protocol` crate — re-exported here so existing
//! `crate::types::{IdentifyRequest, IdentifyResponse, SpeciesSuggestion}`
//! imports keep working.

use serde::{Deserialize, Serialize};

pub use observing_species_id_protocol::{IdentifyRequest, IdentifyResponse, SpeciesSuggestion};

#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub uptime_secs: u64,
    pub model_version: String,
    pub species_count: usize,
}

/// Request body for the prototype `/detect` endpoint.
///
/// Lives here rather than in `observing-species-id-protocol` while the
/// endpoint is a prototype with no appview client. Its boxes use the same
/// convention as `/identify`'s `crop`, so a box can be sent back as the crop.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectRequest {
    /// Base64-encoded image data
    pub image: String,
    /// Drop detections scoring below this (0–1).
    #[serde(default = "default_min_score")]
    pub min_score: f32,
    /// Maximum number of detections to return (default 20, capped at 50).
    #[serde(default = "default_detect_limit")]
    pub limit: usize,
}

fn default_min_score() -> f32 {
    0.2
}

fn default_detect_limit() -> usize {
    20
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResponse {
    /// Sorted by descending score; boxes are fractions of the image after
    /// its EXIF rotation.
    pub detections: Vec<crate::detector::Detection>,
    pub model_version: String,
    pub inference_time_ms: u64,
}
