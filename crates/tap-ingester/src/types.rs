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
}
