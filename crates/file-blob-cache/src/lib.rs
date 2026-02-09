//! File-based blob cache with TTL expiration and LRU eviction
//!
//! Provides a cache that stores binary blobs on disk with in-memory metadata
//! tracking, automatic TTL-based expiration, and size-based LRU eviction.

mod cache;
mod types;

pub use cache::BlobCache;
pub use types::{CacheEntry, CacheStats};
