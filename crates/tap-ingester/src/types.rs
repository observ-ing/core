//! Core types for tap-ingester.

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

/// Collections we ingest. Used both as Tap collection-filters and as
/// dispatch keys in `process_record`.
pub const OCCURRENCE_COLLECTION: &str = "bio.lexicons.temp.v0-1.occurrence";
pub const IDENTIFICATION_COLLECTION: &str = "bio.lexicons.temp.v0-1.identification";
pub const COMMENT_COLLECTION: &str = "ing.observ.temp.comment";
pub const INTERACTION_COLLECTION: &str = "ing.observ.temp.interaction";
pub const LIKE_COLLECTION: &str = "ing.observ.temp.like";

#[cfg(test)]
mod tests {
    use super::*;

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
            uri: "at://did:plc:test/bio.lexicons.temp.v0-1.occurrence/1".to_string(),
            time: chrono::Utc::now(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\""));
        assert!(json.contains("occurrence"));
    }

    #[test]
    fn test_collection_constants() {
        assert_eq!(OCCURRENCE_COLLECTION, "bio.lexicons.temp.v0-1.occurrence");
        assert_eq!(
            IDENTIFICATION_COLLECTION,
            "bio.lexicons.temp.v0-1.identification"
        );
        assert_eq!(COMMENT_COLLECTION, "ing.observ.temp.comment");
        assert_eq!(INTERACTION_COLLECTION, "ing.observ.temp.interaction");
        assert_eq!(LIKE_COLLECTION, "ing.observ.temp.like");
    }
}
