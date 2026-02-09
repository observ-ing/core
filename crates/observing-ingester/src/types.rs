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
}

impl Default for IngesterConfig {
    fn default() -> Self {
        Self {
            relay_url: "wss://jetstream2.us-east.bsky.network/subscribe".to_string(),
            database_url: String::new(),
            cursor: None,
            port: 8080,
        }
    }
}

/// The collection types we care about
pub const OCCURRENCE_COLLECTION: &str = "org.rwell.test.occurrence";
pub const IDENTIFICATION_COLLECTION: &str = "org.rwell.test.identification";
pub const COMMENT_COLLECTION: &str = "org.rwell.test.comment";
pub const INTERACTION_COLLECTION: &str = "org.rwell.test.interaction";
pub const LIKE_COLLECTION: &str = "app.bsky.feed.like";

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
