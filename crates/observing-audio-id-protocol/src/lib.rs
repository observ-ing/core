//! Wire types shared between the `observing-audio-id` service and the
//! `observing-appview` client. Mirrors `observing-species-id-protocol` but
//! the request carries a base64-encoded audio clip instead of an image.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Request body for the audio-id `/identify` endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyRequest {
    /// Base64-encoded audio data (wav/mp3/flac/ogg — decoded by symphonia).
    pub audio: String,
    /// Latitude for geo-prior reranking
    #[serde(default)]
    pub latitude: Option<f64>,
    /// Longitude for geo-prior reranking
    #[serde(default)]
    pub longitude: Option<f64>,
    /// Number of suggestions to return (default: 5)
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    5
}

/// A single ranked species suggestion returned by the audio identification
/// service. Shape matches `observing_species_id_protocol::SpeciesSuggestion`
/// so the frontend can render image-ID and sound-ID results with the same
/// component.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct SpeciesSuggestion {
    pub scientific_name: String,
    pub confidence: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub common_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kingdom: Option<String>,
    /// Whether this species' iNat range covers the request lat/lon.
    /// `None` when geo lookup wasn't performed.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub in_range: Option<bool>,
}

/// Top-level response shape for the audio-id `/identify` endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyResponse {
    pub suggestions: Vec<SpeciesSuggestion>,
    pub model_version: String,
    pub inference_time_ms: u64,
    /// Duration of the decoded clip in seconds. Surfaced so the appview can
    /// warn the user when an upload was so short or so long that the model's
    /// 5-second framing dominates the result (a 0.5s clip is zero-padded;
    /// a 5-minute clip is max-pooled across many frames).
    pub clip_duration_secs: f32,
}
