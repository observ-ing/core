//! Core types for the Observ.ing media proxy

use serde::Serialize;
use std::path::PathBuf;

/// Configuration for the media proxy
#[derive(Debug, Clone)]
pub struct MediaProxyConfig {
    pub port: u16,
    pub cache_dir: PathBuf,
    pub max_cache_size: u64,
    pub cache_ttl_secs: u64,
}

impl Default for MediaProxyConfig {
    fn default() -> Self {
        Self {
            port: 3001,
            cache_dir: PathBuf::from("./cache/media"),
            max_cache_size: 1024 * 1024 * 1024, // 1GB
            cache_ttl_secs: 24 * 60 * 60,       // 24 hours
        }
    }
}

/// Health check response
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub uptime_secs: u64,
    pub cache: file_blob_cache::CacheStats,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = MediaProxyConfig::default();
        assert_eq!(config.port, 3001);
        assert_eq!(config.cache_dir, PathBuf::from("./cache/media"));
        assert_eq!(config.max_cache_size, 1024 * 1024 * 1024);
        assert_eq!(config.cache_ttl_secs, 24 * 60 * 60);
    }

    #[test]
    fn test_health_response_serialization() {
        let response = HealthResponse {
            status: "healthy".to_string(),
            uptime_secs: 3600,
            cache: file_blob_cache::CacheStats {
                entries: 100,
                total_size: 50_000_000,
                hits: 500,
                misses: 50,
            },
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("healthy"));
        assert!(json.contains("3600"));
        assert!(json.contains("500"));
    }
}
