//! Wire types shared between the `observing-species-id` service and the
//! `observing-appview` client. Lives in its own crate so the appview
//! doesn't pull in the heavy ONNX / image / h3o dependencies of the
//! service implementation just to deserialize a JSON response.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Request body for the species-id `/identify` endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyRequest {
    /// Base64-encoded image data
    pub image: String,
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

/// A single ranked species suggestion returned by the identification service.
///
/// `kingdom` is used by the frontend for the taxon link target and is passed
/// to GBIF's `match_name` as a disambiguator when the appview enriches a
/// missing common name.
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
    /// `None` when geo lookup wasn't performed (no lat/lon, no geo index)
    /// or when the cell at the request point is unknown to the index — i.e.
    /// the field is only populated with an opinion when one is well-founded.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub in_range: Option<bool>,
}

/// Top-level response shape for the species-id `/identify` endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyResponse {
    pub suggestions: Vec<SpeciesSuggestion>,
    pub model_version: String,
    pub inference_time_ms: u64,
}
