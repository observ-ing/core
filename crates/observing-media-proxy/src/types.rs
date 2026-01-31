//! Core types for the Observ.ing media proxy

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Metadata for a cached blob entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    pub path: PathBuf,
    pub content_type: String,
    pub size: u64,
    pub created_at: DateTime<Utc>,
}

/// Statistics about the cache
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CacheStats {
    pub entries: usize,
    pub total_size: u64,
    pub hits: u64,
    pub misses: u64,
}

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

/// Response from the PLC directory for DID resolution
#[derive(Debug, Deserialize)]
pub struct PlcDirectoryResponse {
    pub service: Option<Vec<PlcService>>,
}

#[derive(Debug, Deserialize)]
pub struct PlcService {
    pub id: String,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    pub service_type: String,
    #[serde(rename = "serviceEndpoint")]
    pub service_endpoint: String,
}

/// Health check response
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub uptime_secs: u64,
    pub cache: CacheStats,
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
    fn test_cache_stats_default() {
        let stats = CacheStats::default();
        assert_eq!(stats.entries, 0);
        assert_eq!(stats.total_size, 0);
        assert_eq!(stats.hits, 0);
        assert_eq!(stats.misses, 0);
    }

    #[test]
    fn test_cache_entry_serialization() {
        let entry = CacheEntry {
            path: PathBuf::from("/cache/abc123"),
            content_type: "image/jpeg".to_string(),
            size: 12345,
            created_at: Utc::now(),
        };

        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("image/jpeg"));
        assert!(json.contains("12345"));

        let deserialized: CacheEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.content_type, entry.content_type);
        assert_eq!(deserialized.size, entry.size);
    }

    #[test]
    fn test_health_response_serialization() {
        let response = HealthResponse {
            status: "healthy".to_string(),
            uptime_secs: 3600,
            cache: CacheStats {
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

    #[test]
    fn test_plc_directory_response_deserialization() {
        let json = r##"{
            "service": [
                {
                    "id": "#atproto_pds",
                    "type": "AtprotoPersonalDataServer",
                    "serviceEndpoint": "https://bsky.social"
                }
            ]
        }"##;

        let response: PlcDirectoryResponse = serde_json::from_str(json).unwrap();
        assert!(response.service.is_some());
        let services = response.service.unwrap();
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].service_endpoint, "https://bsky.social");
    }
}
