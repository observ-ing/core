//! In-process AT Protocol blob cache + PDS fetch.
//!
//! Replaces the previous `observing-media-proxy` HTTP service. The cache and
//! resolver live as a [`MediaCache`] held by [`crate::state::AppState`] and
//! are used directly by the [`crate::routes::media`] handlers — no HTTP hop.

use atproto_blob_resolver::BlobResolver;
use chrono::{DateTime, Utc};
use file_blob_cache::BlobCache;
use std::path::PathBuf;
use std::sync::Arc;

/// Default cache TTL: 24 hours, matching the previous media-proxy default.
const DEFAULT_CACHE_TTL_SECS: u64 = 24 * 60 * 60;
/// Default cache capacity: 1 GB, matching the previous media-proxy default.
const DEFAULT_MAX_CACHE_SIZE: u64 = 1024 * 1024 * 1024;

/// Cache + PDS-fetcher pair. Cheap to clone (everything inside is `Arc`-able
/// or already cheap to share).
pub struct MediaCache {
    pub cache: BlobCache,
    pub fetcher: BlobResolver,
    pub started_at: DateTime<Utc>,
}

impl MediaCache {
    /// Build a new cache from environment variables.
    ///
    /// Reads `CACHE_DIR` (default `./cache/media`), `MAX_CACHE_SIZE`
    /// (default 1 GB), and `CACHE_TTL_SECS` (default 24h) — same names the
    /// previous media-proxy binary used.
    pub async fn from_env() -> Arc<Self> {
        let cache_dir = std::env::var("CACHE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./cache/media"));
        let max_cache_size = std::env::var("MAX_CACHE_SIZE")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(DEFAULT_MAX_CACHE_SIZE);
        let cache_ttl_secs = std::env::var("CACHE_TTL_SECS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(DEFAULT_CACHE_TTL_SECS);

        tracing::info!(
            cache_dir = %cache_dir.display(),
            max_cache_size_mb = max_cache_size / (1024 * 1024),
            cache_ttl_secs,
            "Initializing in-process media cache"
        );

        let cache = BlobCache::new(cache_dir, max_cache_size, cache_ttl_secs);
        if let Err(e) = cache.init().await {
            tracing::error!(error = %e, "Failed to initialize media cache directory");
        }

        Arc::new(Self {
            cache,
            fetcher: BlobResolver::new(),
            started_at: Utc::now(),
        })
    }
}
