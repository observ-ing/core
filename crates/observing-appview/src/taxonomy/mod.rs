//! In-process taxonomy resolution: GBIF lookups with optional Wikidata
//! enrichment, plus an in-memory Moka cache.
//!
//! Replaces the previous `observing-taxonomy` HTTP service. The route
//! handlers in [`crate::routes::taxonomy`] call into [`gbif::GbifClient`]
//! directly; response shapes are still defined in [`crate::taxonomy_client`]
//! so TypeScript bindings remain stable.

pub mod gbif;
pub mod wikidata;

pub use gbif::{CacheStats, GbifClient};
