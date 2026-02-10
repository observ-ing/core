//! Nominatim Reverse Geocoding Client
//!
//! A Rust client for the [Nominatim](https://nominatim.org/) reverse geocoding API
//! with built-in rate limiting (1 req/sec) and moka async caching.

mod client;
mod continents;
mod error;
mod types;

pub use client::NominatimClient;
pub use error::{NominatimError, Result};
pub use types::GeocodedLocation;
