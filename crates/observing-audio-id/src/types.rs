//! Data types for the audio identification service.
//!
//! Wire types live in the `observing-audio-id-protocol` crate; re-exported
//! here so `crate::types::{IdentifyRequest, IdentifyResponse, SpeciesSuggestion}`
//! imports keep working alongside service-internal types like `HealthResponse`.

use serde::Serialize;

pub use observing_audio_id_protocol::{IdentifyRequest, IdentifyResponse, SpeciesSuggestion};

#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub uptime_secs: u64,
    pub model_version: String,
    pub species_count: usize,
}
