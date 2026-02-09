//! Event types emitted by the Jetstream subscription

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Events emitted by the Jetstream subscription
#[derive(Debug)]
pub enum JetstreamEvent {
    /// A commit (create/update/delete) on a record
    Commit(CommitInfo),
    /// Periodic timing update for lag tracking
    TimingUpdate(TimingInfo),
    /// Successfully connected to Jetstream
    Connected,
    /// Disconnected from Jetstream
    Disconnected,
    /// An error occurred
    Error(String),
}

/// Information about a single commit from Jetstream
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub did: String,
    pub collection: String,
    pub rkey: String,
    pub uri: String,
    pub cid: String,
    pub operation: String,
    pub seq: i64,
    pub time: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<serde_json::Value>,
}

/// Timing information for lag tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimingInfo {
    pub seq: i64,
    pub time: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_commit_info_serialization() {
        let commit = CommitInfo {
            did: "did:plc:abc123".to_string(),
            collection: "app.example.record".to_string(),
            rkey: "123".to_string(),
            uri: "at://did:plc:abc123/app.example.record/123".to_string(),
            cid: "bafyreiabc".to_string(),
            operation: "create".to_string(),
            seq: 12345,
            time: Utc::now(),
            record: Some(serde_json::json!({"key": "value"})),
        };

        let json = serde_json::to_string(&commit).unwrap();
        assert!(json.contains("did:plc:abc123"));
        assert!(json.contains("app.example.record"));

        let deserialized: CommitInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.did, commit.did);
        assert_eq!(deserialized.uri, commit.uri);
        assert_eq!(deserialized.operation, commit.operation);
    }

    #[test]
    fn test_commit_info_without_record() {
        let commit = CommitInfo {
            did: "did:plc:test".to_string(),
            collection: "app.example.item".to_string(),
            rkey: "1".to_string(),
            uri: "at://did:plc:test/app.example.item/1".to_string(),
            cid: "bafytest".to_string(),
            operation: "delete".to_string(),
            seq: 1,
            time: Utc::now(),
            record: None,
        };

        let json = serde_json::to_string(&commit).unwrap();
        // record field should be omitted when None
        assert!(!json.contains("\"record\""));
    }

    #[test]
    fn test_timing_info_serialization() {
        let time = Utc::now();
        let timing = TimingInfo { seq: 999, time };

        let json = serde_json::to_string(&timing).unwrap();
        assert!(json.contains("999"));

        let deserialized: TimingInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.seq, 999);
    }
}
