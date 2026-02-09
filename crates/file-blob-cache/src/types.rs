//! Cache types

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
