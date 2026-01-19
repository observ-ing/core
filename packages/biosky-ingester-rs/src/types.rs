//! Core types for the BioSky ingester
//!
//! These types represent AT Protocol firehose events and BioSky-specific records.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// The type of operation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpAction {
    Create,
    Update,
    Delete,
}

impl OpAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            OpAction::Create => "create",
            OpAction::Update => "update",
            OpAction::Delete => "delete",
        }
    }
}

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
            relay_url: "wss://bsky.network".to_string(),
            database_url: String::new(),
            cursor: None,
            port: 8080,
        }
    }
}

/// The collection types we care about
pub const OCCURRENCE_COLLECTION: &str = "org.rwell.test.occurrence";
pub const IDENTIFICATION_COLLECTION: &str = "org.rwell.test.identification";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_op_action_as_str() {
        assert_eq!(OpAction::Create.as_str(), "create");
        assert_eq!(OpAction::Update.as_str(), "update");
        assert_eq!(OpAction::Delete.as_str(), "delete");
    }

    #[test]
    fn test_default_config() {
        let config = IngesterConfig::default();
        assert_eq!(config.relay_url, "wss://bsky.network");
        assert_eq!(config.port, 8080);
        assert!(config.cursor.is_none());
    }
}
