//! Core types for the Observ.ing ingester
//!
//! These types represent AT Protocol firehose events and Observ.ing-specific records.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// An occurrence event (biodiversity observation)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OccurrenceEvent {
    pub did: String,
    pub uri: String,
    pub cid: String,
    pub action: String,
    pub seq: i64,
    pub time: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<serde_json::Value>,
}

/// An identification event (community ID on an observation)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentificationEvent {
    pub did: String,
    pub uri: String,
    pub cid: String,
    pub action: String,
    pub seq: i64,
    pub time: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<serde_json::Value>,
}

/// A comment event (discussion on an observation)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentEvent {
    pub did: String,
    pub uri: String,
    pub cid: String,
    pub action: String,
    pub seq: i64,
    pub time: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<serde_json::Value>,
}

/// An interaction event (species interaction between organisms)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionEvent {
    pub did: String,
    pub uri: String,
    pub cid: String,
    pub action: String,
    pub seq: i64,
    pub time: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<serde_json::Value>,
}

/// Timing information for lag tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitTimingInfo {
    pub seq: i64,
    pub time: DateTime<Utc>,
}

/// Statistics about the ingester's operation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IngesterStats {
    pub occurrences: u64,
    pub identifications: u64,
    pub comments: u64,
    pub interactions: u64,
    pub errors: u64,
}

/// A recent event for display in the dashboard
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub action: String,
    pub uri: String,
    pub time: DateTime<Utc>,
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
        assert_eq!(stats.errors, 0);
    }

    #[test]
    fn test_occurrence_event_serialization() {
        let event = OccurrenceEvent {
            did: "did:plc:abc123".to_string(),
            uri: "at://did:plc:abc123/org.rwell.test.occurrence/123".to_string(),
            cid: "bafyreiabc".to_string(),
            action: "create".to_string(),
            seq: 12345,
            time: Utc::now(),
            record: Some(serde_json::json!({"scientificName": "Quercus alba"})),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("did:plc:abc123"));
        assert!(json.contains("Quercus alba"));

        let deserialized: OccurrenceEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.did, event.did);
        assert_eq!(deserialized.uri, event.uri);
        assert_eq!(deserialized.action, event.action);
    }

    #[test]
    fn test_identification_event_serialization() {
        let event = IdentificationEvent {
            did: "did:plc:xyz789".to_string(),
            uri: "at://did:plc:xyz789/org.rwell.test.identification/456".to_string(),
            cid: "bafyreixyz".to_string(),
            action: "create".to_string(),
            seq: 67890,
            time: Utc::now(),
            record: Some(serde_json::json!({
                "taxonName": "Quercus alba",
                "taxonRank": "species"
            })),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("did:plc:xyz789"));
        assert!(json.contains("Quercus alba"));

        let deserialized: IdentificationEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.did, event.did);
        assert_eq!(deserialized.action, event.action);
    }

    #[test]
    fn test_occurrence_event_without_record() {
        let event = OccurrenceEvent {
            did: "did:plc:test".to_string(),
            uri: "at://did:plc:test/org.rwell.test.occurrence/1".to_string(),
            cid: "bafytest".to_string(),
            action: "delete".to_string(),
            seq: 1,
            time: Utc::now(),
            record: None,
        };

        let json = serde_json::to_string(&event).unwrap();
        // record field should be omitted when None
        assert!(!json.contains("record"));
    }

    #[test]
    fn test_commit_timing_info() {
        let time = Utc::now();
        let timing = CommitTimingInfo { seq: 999, time };

        let json = serde_json::to_string(&timing).unwrap();
        assert!(json.contains("999"));

        let deserialized: CommitTimingInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.seq, 999);
    }

    #[test]
    fn test_recent_event_serialization() {
        let event = RecentEvent {
            event_type: "occurrence".to_string(),
            action: "create".to_string(),
            uri: "at://did:plc:test/org.rwell.test.occurrence/1".to_string(),
            time: Utc::now(),
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
    }
}
