//! Core types for the Observ.ing ingester

use serde::{Deserialize, Serialize};

/// Statistics about the ingester's operation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IngesterStats {
    pub occurrences: u64,
    pub identifications: u64,
    pub comments: u64,
    pub interactions: u64,
    pub likes: u64,
    pub errors: u64,
}

/// A recent event for display in the dashboard
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub action: String,
    pub uri: String,
    pub time: chrono::DateTime<chrono::Utc>,
}

/// Configuration for the ingester
#[derive(Debug, Clone)]
pub struct IngesterConfig {
    pub relay_url: String,
    pub database_url: String,
    pub cursor: Option<i64>,
    pub port: u16,
    /// Full NSIDs of collections to subscribe to
    pub collections: Vec<String>,
}

impl Default for IngesterConfig {
    fn default() -> Self {
        Self {
            relay_url: "wss://jetstream2.us-east.bsky.network/subscribe".to_string(),
            database_url: String::new(),
            cursor: None,
            port: 8080,
            collections: ALL_COLLECTIONS
                .iter()
                .map(|(_, nsid)| nsid.to_string())
                .collect(),
        }
    }
}

/// The collection types we care about
pub const OCCURRENCE_COLLECTION: &str = "org.rwell.test.occurrence";
pub const IDENTIFICATION_COLLECTION: &str = "org.rwell.test.identification";
pub const COMMENT_COLLECTION: &str = "org.rwell.test.comment";
pub const INTERACTION_COLLECTION: &str = "org.rwell.test.interaction";
pub const LIKE_COLLECTION: &str = "app.bsky.feed.like";

/// All known collection short names and their full NSIDs.
pub const ALL_COLLECTIONS: &[(&str, &str)] = &[
    ("occurrence", OCCURRENCE_COLLECTION),
    ("identification", IDENTIFICATION_COLLECTION),
    ("comment", COMMENT_COLLECTION),
    ("interaction", INTERACTION_COLLECTION),
    ("like", LIKE_COLLECTION),
];

/// Resolve a comma-separated list of short collection names to full NSIDs.
/// Returns an error string if any name is unrecognized.
pub fn resolve_collection_names(names: &str) -> std::result::Result<Vec<String>, String> {
    let known: std::collections::HashMap<&str, &str> =
        ALL_COLLECTIONS.iter().copied().collect();
    let mut result = Vec::new();
    for name in names.split(',') {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        match known.get(name) {
            Some(nsid) => result.push(nsid.to_string()),
            None => {
                let valid: Vec<&str> = ALL_COLLECTIONS.iter().map(|(n, _)| *n).collect();
                return Err(format!(
                    "unknown collection '{}'; valid names: {}",
                    name,
                    valid.join(", ")
                ));
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = IngesterConfig::default();
        assert_eq!(
            config.relay_url,
            "wss://jetstream2.us-east.bsky.network/subscribe"
        );
        assert_eq!(config.port, 8080);
        assert!(config.cursor.is_none());
        assert!(config.database_url.is_empty());
        assert_eq!(config.collections.len(), ALL_COLLECTIONS.len());
    }

    #[test]
    fn test_resolve_collection_names_single() {
        let result = resolve_collection_names("occurrence").unwrap();
        assert_eq!(result, vec![OCCURRENCE_COLLECTION]);
    }

    #[test]
    fn test_resolve_collection_names_multiple() {
        let result =
            resolve_collection_names("occurrence,identification,comment").unwrap();
        assert_eq!(
            result,
            vec![
                OCCURRENCE_COLLECTION,
                IDENTIFICATION_COLLECTION,
                COMMENT_COLLECTION,
            ]
        );
    }

    #[test]
    fn test_resolve_collection_names_with_whitespace() {
        let result =
            resolve_collection_names("occurrence , like").unwrap();
        assert_eq!(result, vec![OCCURRENCE_COLLECTION, LIKE_COLLECTION]);
    }

    #[test]
    fn test_resolve_collection_names_unknown() {
        let err = resolve_collection_names("occurrence,bogus").unwrap_err();
        assert!(err.contains("unknown collection 'bogus'"));
        assert!(err.contains("valid names:"));
    }

    #[test]
    fn test_resolve_collection_names_empty() {
        let result = resolve_collection_names("").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_ingester_stats_default() {
        let stats = IngesterStats::default();
        assert_eq!(stats.occurrences, 0);
        assert_eq!(stats.identifications, 0);
        assert_eq!(stats.likes, 0);
        assert_eq!(stats.errors, 0);
    }

    #[test]
    fn test_recent_event_serialization() {
        let event = RecentEvent {
            event_type: "occurrence".to_string(),
            action: "create".to_string(),
            uri: "at://did:plc:test/org.rwell.test.occurrence/1".to_string(),
            time: chrono::Utc::now(),
        };

        let json = serde_json::to_string(&event).unwrap();
        // event_type should be serialized as "type"
        assert!(json.contains("\"type\""));
        assert!(json.contains("occurrence"));
    }

    #[test]
    fn test_collection_constants() {
        assert_eq!(OCCURRENCE_COLLECTION, "org.rwell.test.occurrence");
        assert_eq!(IDENTIFICATION_COLLECTION, "org.rwell.test.identification");
        assert_eq!(COMMENT_COLLECTION, "org.rwell.test.comment");
        assert_eq!(INTERACTION_COLLECTION, "org.rwell.test.interaction");
        assert_eq!(LIKE_COLLECTION, "app.bsky.feed.like");
    }
}
