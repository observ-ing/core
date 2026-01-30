//! Observ.ing Media Proxy - High-performance media caching proxy
//!
//! This service proxies and caches image blobs from various PDS servers
//! for performant frontend loading.

mod cache;
mod error;
mod proxy;
mod server;
mod types;

use crate::cache::BlobCache;
use crate::error::{MediaProxyError, Result};
use crate::proxy::BlobFetcher;
use crate::server::{start_server, ServerState, SharedState};
use crate::types::MediaProxyConfig;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;
use tracing_subscriber::{prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    let env_filter =
        EnvFilter::from_default_env().add_directive("observing_media_proxy=info".parse()?);

    // Use JSON format for GCP Cloud Logging when LOG_FORMAT=json
    if std::env::var("LOG_FORMAT")
        .map(|v| v == "json")
        .unwrap_or(false)
    {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_stackdriver::layer())
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(env_filter).init();
    };

    info!("Starting Observ.ing Media Proxy (Rust)...");

    // Load configuration from environment
    let config = load_config()?;
    info!("Port: {}", config.port);
    info!("Cache dir: {:?}", config.cache_dir);
    info!(
        "Max cache size: {} MB",
        config.max_cache_size / (1024 * 1024)
    );
    info!("Cache TTL: {} seconds", config.cache_ttl_secs);

    // Create cache and fetcher
    let cache = BlobCache::new(config.cache_dir, config.max_cache_size, config.cache_ttl_secs);
    cache.init().await?;

    let fetcher = BlobFetcher::new();

    // Create shared state
    let state: SharedState = Arc::new(ServerState::new(cache, fetcher));

    // Start HTTP server (blocking)
    start_server(state, config.port)
        .await
        .map_err(|e| MediaProxyError::Config(format!("Server error: {}", e)))?;

    Ok(())
}

fn load_config() -> Result<MediaProxyConfig> {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(3001);

    let cache_dir = std::env::var("CACHE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./cache/media"));

    let max_cache_size = std::env::var("MAX_CACHE_SIZE")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(1024 * 1024 * 1024); // 1GB default

    let cache_ttl_secs = std::env::var("CACHE_TTL_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(24 * 60 * 60); // 24 hours default

    Ok(MediaProxyConfig {
        port,
        cache_dir,
        max_cache_size,
        cache_ttl_secs,
    })
}
