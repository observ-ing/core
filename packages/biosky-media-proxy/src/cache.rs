//! File-based blob caching with in-memory metadata

use crate::error::Result;
use crate::types::{CacheEntry, CacheStats};
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

/// A blob cache with in-memory metadata and file-based storage
pub struct BlobCache {
    /// In-memory metadata for cached entries
    entries: Arc<RwLock<HashMap<String, CacheEntry>>>,
    /// Directory where cached blobs are stored
    cache_dir: PathBuf,
    /// Maximum cache size in bytes
    max_size: u64,
    /// Cache TTL in seconds
    ttl_secs: u64,
    /// Current total size of cached blobs
    current_size: Arc<AtomicU64>,
    /// Cache hit counter
    hits: Arc<AtomicU64>,
    /// Cache miss counter
    misses: Arc<AtomicU64>,
}

impl BlobCache {
    /// Create a new blob cache
    pub fn new(cache_dir: PathBuf, max_size: u64, ttl_secs: u64) -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
            cache_dir,
            max_size,
            ttl_secs,
            current_size: Arc::new(AtomicU64::new(0)),
            hits: Arc::new(AtomicU64::new(0)),
            misses: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Initialize the cache by ensuring the cache directory exists
    pub async fn init(&self) -> Result<()> {
        fs::create_dir_all(&self.cache_dir).await?;
        info!(cache_dir = ?self.cache_dir, "Cache initialized");
        Ok(())
    }

    /// Generate a cache key from DID and CID
    pub fn cache_key(did: &str, cid: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(format!("{}:{}", did, cid).as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Get a blob from the cache, returns (data, content_type) if found
    pub async fn get(&self, did: &str, cid: &str) -> Option<(Vec<u8>, String)> {
        let key = Self::cache_key(did, cid);

        // Check in-memory metadata
        let entry = {
            let entries = self.entries.read().await;
            entries.get(&key).cloned()
        };

        if let Some(entry) = entry {
            // Check if entry is expired
            let age_secs = (Utc::now() - entry.created_at).num_seconds() as u64;
            if age_secs > self.ttl_secs {
                debug!(key = %key, age_secs, ttl_secs = self.ttl_secs, "Cache entry expired");
                self.remove(&key).await;
                self.misses.fetch_add(1, Ordering::Relaxed);
                return None;
            }

            // Try to read the file
            match fs::read(&entry.path).await {
                Ok(data) => {
                    self.hits.fetch_add(1, Ordering::Relaxed);
                    debug!(key = %key, "Cache hit");
                    return Some((data, entry.content_type));
                }
                Err(e) => {
                    warn!(key = %key, error = %e, "Failed to read cached file, removing entry");
                    self.remove(&key).await;
                }
            }
        }

        self.misses.fetch_add(1, Ordering::Relaxed);
        None
    }

    /// Store a blob in the cache
    pub async fn put(&self, did: &str, cid: &str, data: &[u8], content_type: &str) -> Result<()> {
        let key = Self::cache_key(did, cid);
        let size = data.len() as u64;

        // Evict entries if needed to make room
        self.evict_if_needed(size).await;

        // Write to disk
        let path = self.cache_dir.join(&key);
        fs::write(&path, data).await?;

        // Update metadata
        let entry = CacheEntry {
            path,
            content_type: content_type.to_string(),
            size,
            created_at: Utc::now(),
        };

        {
            let mut entries = self.entries.write().await;
            entries.insert(key.clone(), entry);
        }

        self.current_size.fetch_add(size, Ordering::Relaxed);
        debug!(key = %key, size, "Cached blob");

        Ok(())
    }

    /// Evict oldest entries until there's enough room for new_size bytes
    async fn evict_if_needed(&self, new_size: u64) {
        let current = self.current_size.load(Ordering::Relaxed);

        if current + new_size <= self.max_size {
            return;
        }

        let target_size = self.max_size.saturating_sub(new_size);

        loop {
            let current = self.current_size.load(Ordering::Relaxed);
            if current <= target_size {
                break;
            }

            // Find and remove oldest entry
            let oldest_key = {
                let entries = self.entries.read().await;
                entries
                    .iter()
                    .min_by_key(|(_, e)| e.created_at)
                    .map(|(k, _)| k.clone())
            };

            if let Some(key) = oldest_key {
                self.remove(&key).await;
                debug!(key = %key, "Evicted oldest cache entry");
            } else {
                break;
            }
        }
    }

    /// Remove an entry from the cache
    async fn remove(&self, key: &str) {
        let entry = {
            let mut entries = self.entries.write().await;
            entries.remove(key)
        };

        if let Some(entry) = entry {
            self.current_size.fetch_sub(entry.size, Ordering::Relaxed);

            // Try to remove the file (ignore errors)
            let _ = fs::remove_file(&entry.path).await;
        }
    }

    /// Get current cache statistics
    pub async fn stats(&self) -> CacheStats {
        let entries = self.entries.read().await;
        CacheStats {
            entries: entries.len(),
            total_size: self.current_size.load(Ordering::Relaxed),
            hits: self.hits.load(Ordering::Relaxed),
            misses: self.misses.load(Ordering::Relaxed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_cache_key_generation() {
        let key1 = BlobCache::cache_key("did:plc:abc123", "bafyreiabc");
        let key2 = BlobCache::cache_key("did:plc:abc123", "bafyreiabc");
        let key3 = BlobCache::cache_key("did:plc:xyz789", "bafyreixyz");

        // Same inputs produce same key
        assert_eq!(key1, key2);

        // Different inputs produce different keys
        assert_ne!(key1, key3);

        // Keys are hex strings (64 chars for SHA256)
        assert_eq!(key1.len(), 64);
        assert!(key1.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn test_cache_put_and_get() {
        let dir = tempdir().unwrap();
        let cache = BlobCache::new(dir.path().to_path_buf(), 1024 * 1024, 3600);
        cache.init().await.unwrap();

        let did = "did:plc:test123";
        let cid = "bafytest";
        let data = b"Hello, world!";
        let content_type = "text/plain";

        // Put data
        cache.put(did, cid, data, content_type).await.unwrap();

        // Get data back
        let result = cache.get(did, cid).await;
        assert!(result.is_some());

        let (retrieved_data, retrieved_type) = result.unwrap();
        assert_eq!(retrieved_data, data);
        assert_eq!(retrieved_type, content_type);
    }

    #[tokio::test]
    async fn test_cache_miss() {
        let dir = tempdir().unwrap();
        let cache = BlobCache::new(dir.path().to_path_buf(), 1024 * 1024, 3600);
        cache.init().await.unwrap();

        let result = cache.get("did:plc:nonexistent", "bafynonexistent").await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_cache_stats() {
        let dir = tempdir().unwrap();
        let cache = BlobCache::new(dir.path().to_path_buf(), 1024 * 1024, 3600);
        cache.init().await.unwrap();

        // Initial stats
        let stats = cache.stats().await;
        assert_eq!(stats.entries, 0);
        assert_eq!(stats.total_size, 0);

        // Add an entry
        cache
            .put("did:plc:test", "bafytest", b"test data", "text/plain")
            .await
            .unwrap();

        let stats = cache.stats().await;
        assert_eq!(stats.entries, 1);
        assert_eq!(stats.total_size, 9); // "test data" = 9 bytes
    }

    #[tokio::test]
    async fn test_cache_hit_miss_counters() {
        let dir = tempdir().unwrap();
        let cache = BlobCache::new(dir.path().to_path_buf(), 1024 * 1024, 3600);
        cache.init().await.unwrap();

        // Miss
        cache.get("did:plc:test", "bafytest").await;
        let stats = cache.stats().await;
        assert_eq!(stats.misses, 1);
        assert_eq!(stats.hits, 0);

        // Put and hit
        cache
            .put("did:plc:test", "bafytest", b"data", "text/plain")
            .await
            .unwrap();
        cache.get("did:plc:test", "bafytest").await;

        let stats = cache.stats().await;
        assert_eq!(stats.misses, 1);
        assert_eq!(stats.hits, 1);
    }

    #[tokio::test]
    async fn test_cache_eviction() {
        let dir = tempdir().unwrap();
        // Small cache: only 20 bytes
        let cache = BlobCache::new(dir.path().to_path_buf(), 20, 3600);
        cache.init().await.unwrap();

        // Add first entry (10 bytes)
        cache
            .put("did:plc:1", "cid1", b"0123456789", "text/plain")
            .await
            .unwrap();

        // Add second entry (10 bytes) - should fit
        cache
            .put("did:plc:2", "cid2", b"abcdefghij", "text/plain")
            .await
            .unwrap();

        // Both should exist
        assert!(cache.get("did:plc:1", "cid1").await.is_some());
        assert!(cache.get("did:plc:2", "cid2").await.is_some());

        // Add third entry (10 bytes) - should evict oldest
        cache
            .put("did:plc:3", "cid3", b"ABCDEFGHIJ", "text/plain")
            .await
            .unwrap();

        // Third should exist, first might be evicted
        assert!(cache.get("did:plc:3", "cid3").await.is_some());

        let stats = cache.stats().await;
        assert!(stats.total_size <= 20);
    }
}
