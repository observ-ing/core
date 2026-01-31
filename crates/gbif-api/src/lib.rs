//! Rust client for the GBIF (Global Biodiversity Information Facility) API
//!
//! This crate provides type-safe bindings to the GBIF Species API, which offers
//! access to the GBIF taxonomic backbone and related biodiversity data.
//!
//! # Example
//!
//! ```no_run
//! use gbif_api::GbifClient;
//!
//! # async fn example() -> Result<(), gbif_api::GbifError> {
//! let client = GbifClient::new();
//!
//! // Search for species
//! let results = client.suggest("Quercus", 10, Some("ACCEPTED")).await?;
//! for result in results {
//!     println!("{:?}", result.scientific_name);
//! }
//!
//! // Match a scientific name (includes IUCN status)
//! if let Some(matched) = client.match_name("Panthera leo", None).await? {
//!     if let Some(iucn) = GbifClient::extract_iucn_status(&matched) {
//!         println!("Conservation status: {:?}", iucn);
//!     }
//! }
//! # Ok(())
//! # }
//! ```
//!
//! # API Coverage
//!
//! This crate covers the following GBIF API endpoints:
//!
//! ## Species API v1
//! - `GET /species/suggest` - Autocomplete species search
//! - `GET /species/{key}` - Get species details
//! - `GET /species/{key}/children` - Get child taxa
//! - `GET /species/{key}/descriptions` - Get taxon descriptions
//! - `GET /species/{key}/references` - Get scientific references
//! - `GET /species/{key}/media` - Get media items
//!
//! ## Species API v2
//! - `GET /species/match` - Match name to backbone taxonomy (includes IUCN status)

mod client;
mod error;
mod types;

pub use client::GbifClient;
pub use error::{GbifError, Result};
pub use types::{
    Description, IucnCategory, ListResponse, Media, Reference, SpeciesDetail, SuggestResult,
    V2AdditionalStatus, V2Diagnostics, V2MatchResult, V2NameUsage,
};
