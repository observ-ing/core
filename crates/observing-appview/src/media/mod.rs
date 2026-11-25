//! In-process AT Protocol blob cache + PDS fetch.
//!
//! Replaces the previous `observing-media-proxy` HTTP service. The cache and
//! resolver live as a [`MediaCache`] held by [`crate::state::AppState`] and
//! are used directly by the [`crate::routes::media`] handlers — no HTTP hop.

use atproto_blob_resolver::BlobResolver;
use chrono::{DateTime, Utc};
use file_blob_cache::BlobCache;
use moka::future::Cache;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

pub mod public_net;
pub mod thumb;

/// Default cache TTL: 24 hours, matching the previous media-proxy default.
const DEFAULT_CACHE_TTL_SECS: u64 = 24 * 60 * 60;
/// Default cache capacity: 1 GB, matching the previous media-proxy default.
const DEFAULT_MAX_CACHE_SIZE: u64 = 1024 * 1024 * 1024;
/// How long a DID's resolved PDS URL is reused. Short, so an account that
/// moves PDS is picked up quickly; a failed blob fetch also drops the entry.
const PDS_URL_TTL: Duration = Duration::from_secs(10 * 60);
/// Maximum number of DIDs whose PDS URL is kept.
const PDS_URL_CAPACITY: u64 = 10_000;
/// How many thumbnails are decoded at once. Each decode holds a full-size
/// pixel buffer (tens to hundreds of MB), so a grid's burst of thumbnail
/// requests mustn't all decode in parallel.
const MAX_CONCURRENT_THUMBNAILS: usize = 4;

/// Cache + PDS-fetcher pair. Cheap to clone (everything inside is `Arc`-able
/// or already cheap to share).
pub struct MediaCache {
    pub cache: BlobCache,
    pub fetcher: BlobResolver,
    /// Whether `fetcher` only reaches public addresses (see [`public_net`]).
    /// Off in local dev, where the PDS and PLC directory are on localhost.
    pub public_only: bool,
    /// DID → PDS URL. Without it every blob cache miss re-resolved the DID
    /// document (a plc.directory round trip), even for a page of images that
    /// all belong to the same account.
    pub pds_urls: Cache<String, String>,
    /// Bounds concurrent thumbnail decodes; see [`MAX_CONCURRENT_THUMBNAILS`].
    pub thumb_permits: Semaphore,
    pub started_at: DateTime<Utc>,
}

impl MediaCache {
    /// Build a new cache from environment variables.
    ///
    /// Reads `CACHE_DIR` (default `./cache/media`), `MAX_CACHE_SIZE`
    /// (default 1 GB), and `CACHE_TTL_SECS` (default 24h) — same names the
    /// previous media-proxy binary used. `public_only` picks the
    /// [`public_net`] client for PDS fetches; pass it in production.
    pub async fn from_env(public_only: bool) -> Arc<Self> {
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
            public_only,
            "Initializing in-process media cache"
        );

        let cache = BlobCache::new(cache_dir, max_cache_size, cache_ttl_secs);
        if let Err(e) = cache.init().await {
            tracing::error!(error = %e, "Failed to initialize media cache directory");
        }

        Arc::new(Self::build(cache, public_only))
    }

    /// A media cache around an already-initialized blob cache, fetching
    /// from any address.
    pub fn new(cache: BlobCache) -> Self {
        Self::build(cache, false)
    }

    pub(crate) fn build(cache: BlobCache, public_only: bool) -> Self {
        let fetcher = if public_only {
            BlobResolver::with_client(public_net::public_only_client())
        } else {
            BlobResolver::new()
        };
        Self {
            cache,
            fetcher,
            public_only,
            pds_urls: Cache::builder()
                .max_capacity(PDS_URL_CAPACITY)
                .time_to_live(PDS_URL_TTL)
                .build(),
            thumb_permits: Semaphore::new(MAX_CONCURRENT_THUMBNAILS),
            started_at: Utc::now(),
        }
    }
}
