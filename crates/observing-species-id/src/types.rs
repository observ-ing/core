//! Data types for species identification service.
//!
//! The wire types shared with the appview client live in the
//! `observing-species-id-protocol` crate — re-exported here so existing
//! `crate::types::{IdentifyRequest, IdentifyResponse, SpeciesSuggestion}`
//! imports keep working.

use serde::Serialize;

pub use observing_species_id_protocol::{
    IdentifyRequest, IdentifyResponse, RankFallback, SpeciesSuggestion,
};

/// What [`crate::model::BioclipModel::identify`] found in a photo.
#[derive(Debug, Clone)]
pub struct Identification {
    pub suggestions: Vec<SpeciesSuggestion>,
    /// A broader taxon, when no species is confident but one is.
    pub fallback: Option<RankFallback>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub uptime_secs: u64,
    pub model_version: String,
    pub species_count: usize,
}
