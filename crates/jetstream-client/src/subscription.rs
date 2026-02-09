//! Jetstream WebSocket subscription
//!
//! Connects to Bluesky's Jetstream service which provides filtered firehose access.
//! Unlike the raw firehose, Jetstream filters server-side and sends JSON.

use crate::error::{JetstreamError, Result};
use crate::event::{CommitInfo, JetstreamEvent, TimingInfo};
use chrono::{TimeZone, Utc};
use futures_util::StreamExt;
use serde::Deserialize;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, warn};

const TIMING_UPDATE_INTERVAL: Duration = Duration::from_secs(5);
const DEFAULT_JETSTREAM: &str = "wss://jetstream2.us-east.bsky.network/subscribe";
const MAX_RECONNECT_ATTEMPTS: u32 = 10;
const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(1);

/// Raw Jetstream event structure (internal)
#[derive(Debug, Deserialize)]
struct RawJetstreamEvent {
    did: String,
    time_us: i64,
    commit: Option<RawJetstreamCommit>,
}

/// Raw Jetstream commit structure (internal)
#[derive(Debug, Deserialize)]
struct RawJetstreamCommit {
    #[allow(dead_code)]
    rev: String,
    operation: String,
    collection: String,
    rkey: String,
    record: Option<serde_json::Value>,
    cid: Option<String>,
}

/// Configuration for the Jetstream subscription
pub struct JetstreamConfig {
    /// Jetstream relay URL
    pub relay: String,
    /// Cursor for resumption (microsecond timestamp)
    pub cursor: Option<i64>,
    /// Collections to subscribe to
    pub wanted_collections: Vec<String>,
}

impl Default for JetstreamConfig {
    fn default() -> Self {
        Self {
            relay: DEFAULT_JETSTREAM.to_string(),
            cursor: None,
            wanted_collections: Vec::new(),
        }
    }
}

/// Jetstream subscription that connects and streams events
pub struct JetstreamSubscription {
    config: JetstreamConfig,
    event_tx: mpsc::Sender<JetstreamEvent>,
    cursor: Option<i64>,
    last_timing: Option<TimingInfo>,
    last_timing_sent: Instant,
}

impl JetstreamSubscription {
    pub fn new(config: JetstreamConfig, event_tx: mpsc::Sender<JetstreamEvent>) -> Self {
        let cursor = config.cursor;
        Self {
            config,
            event_tx,
            cursor,
            last_timing: None,
            last_timing_sent: Instant::now(),
        }
    }

    /// Start the subscription (runs until stopped or max reconnects)
    pub async fn run(&mut self) -> Result<()> {
        let mut reconnect_attempts = 0;

        loop {
            match self.connect_and_stream().await {
                Ok(()) => {
                    info!("Jetstream connection closed cleanly");
                    break;
                }
                Err(e) => {
                    error!("Jetstream error: {}", e);
                    let _ = self
                        .event_tx
                        .send(JetstreamEvent::Error(e.to_string()))
                        .await;

                    reconnect_attempts += 1;
                    if reconnect_attempts >= MAX_RECONNECT_ATTEMPTS {
                        return Err(JetstreamError::MaxReconnectAttempts);
                    }

                    let delay = INITIAL_RECONNECT_DELAY * 2u32.pow(reconnect_attempts - 1);
                    warn!(
                        "Reconnecting in {:?} (attempt {}/{})",
                        delay, reconnect_attempts, MAX_RECONNECT_ATTEMPTS
                    );
                    tokio::time::sleep(delay).await;
                }
            }
        }

        Ok(())
    }

    async fn connect_and_stream(&mut self) -> Result<()> {
        let url = self.build_url();
        info!("Connecting to Jetstream: {}", url);

        let (ws_stream, _) = connect_async(&url).await?;
        let (mut _write, mut read) = ws_stream.split();

        let _ = self.event_tx.send(JetstreamEvent::Connected).await;
        info!("Jetstream connection established");

        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Err(e) = self.handle_message(&text).await {
                        debug!("Error processing message: {}", e);
                    }
                }
                Ok(Message::Close(_)) => {
                    info!("Received close frame");
                    let _ = self.event_tx.send(JetstreamEvent::Disconnected).await;
                    break;
                }
                Ok(_) => {
                    // Ignore binary, ping, pong messages
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    let _ = self.event_tx.send(JetstreamEvent::Disconnected).await;
                    return Err(e.into());
                }
            }
        }

        Ok(())
    }

    fn build_url(&self) -> String {
        let mut url = self.config.relay.clone();

        if !self.config.wanted_collections.is_empty() {
            let separator = if url.contains('?') { '&' } else { '?' };
            let collections: Vec<String> = self
                .config
                .wanted_collections
                .iter()
                .map(|c| format!("wantedCollections={}", c))
                .collect();
            url = format!("{}{}{}", url, separator, collections.join("&"));
        }

        // Add cursor if available (Jetstream uses microseconds)
        if let Some(cursor) = self.cursor {
            let separator = if url.contains('?') { '&' } else { '?' };
            url = format!("{}{}cursor={}", url, separator, cursor);
        }

        url
    }

    async fn handle_message(&mut self, text: &str) -> Result<()> {
        let event: RawJetstreamEvent = serde_json::from_str(text)
            .map_err(|e| JetstreamError::JsonParse(format!("JSON parse error: {}", e)))?;

        let time = Utc
            .timestamp_micros(event.time_us)
            .single()
            .unwrap_or_else(Utc::now);
        let seq = event.time_us; // Jetstream uses time_us as cursor

        // Update timing info periodically
        self.last_timing = Some(TimingInfo { seq, time });
        if self.last_timing_sent.elapsed() >= TIMING_UPDATE_INTERVAL {
            if let Some(ref timing) = self.last_timing {
                let _ = self
                    .event_tx
                    .send(JetstreamEvent::TimingUpdate(timing.clone()))
                    .await;
            }
            self.last_timing_sent = Instant::now();
        }

        // Emit commit event if present
        if let Some(commit) = event.commit {
            let did = &event.did;
            let collection = &commit.collection;
            let rkey = &commit.rkey;
            let uri = format!("at://{}/{}/{}", did, collection, rkey);
            let cid = commit.cid.unwrap_or_default();

            let commit_info = CommitInfo {
                did: did.to_string(),
                collection: collection.to_string(),
                rkey: rkey.to_string(),
                uri,
                cid,
                operation: commit.operation,
                seq,
                time,
                record: commit.record,
            };

            debug!(
                "[{}] {}: {}",
                commit_info.collection, commit_info.operation, commit_info.uri
            );
            let _ = self
                .event_tx
                .send(JetstreamEvent::Commit(commit_info))
                .await;
        }

        // Update cursor
        self.cursor = Some(seq);

        Ok(())
    }

    #[allow(dead_code)]
    pub fn get_cursor(&self) -> Option<i64> {
        self.cursor
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_url_no_cursor_no_collections() {
        let (tx, _rx) = mpsc::channel(10);
        let sub = JetstreamSubscription::new(JetstreamConfig::default(), tx);
        let url = sub.build_url();
        assert_eq!(url, DEFAULT_JETSTREAM);
        assert!(!url.contains("cursor="));
        assert!(!url.contains("wantedCollections="));
    }

    #[test]
    fn test_build_url_with_collections() {
        let (tx, _rx) = mpsc::channel(10);
        let config = JetstreamConfig {
            wanted_collections: vec!["app.example.foo".to_string(), "app.example.bar".to_string()],
            ..Default::default()
        };
        let sub = JetstreamSubscription::new(config, tx);
        let url = sub.build_url();
        assert!(url.contains("wantedCollections=app.example.foo"));
        assert!(url.contains("wantedCollections=app.example.bar"));
    }

    #[test]
    fn test_build_url_with_cursor() {
        let (tx, _rx) = mpsc::channel(10);
        let config = JetstreamConfig {
            cursor: Some(1234567890),
            ..Default::default()
        };
        let sub = JetstreamSubscription::new(config, tx);
        let url = sub.build_url();
        assert!(url.contains("cursor=1234567890"));
    }

    #[test]
    fn test_build_url_with_collections_and_cursor() {
        let (tx, _rx) = mpsc::channel(10);
        let config = JetstreamConfig {
            relay: "wss://example.com/subscribe".to_string(),
            cursor: Some(999),
            wanted_collections: vec!["app.example.foo".to_string()],
        };
        let sub = JetstreamSubscription::new(config, tx);
        let url = sub.build_url();
        assert!(url.contains("wantedCollections=app.example.foo"));
        assert!(url.contains("cursor=999"));
        assert!(url.starts_with("wss://example.com/subscribe?"));
    }

    #[test]
    fn test_build_url_custom_relay() {
        let (tx, _rx) = mpsc::channel(10);
        let config = JetstreamConfig {
            relay: "wss://custom.jetstream.example/subscribe".to_string(),
            cursor: None,
            wanted_collections: Vec::new(),
        };
        let sub = JetstreamSubscription::new(config, tx);
        let url = sub.build_url();
        assert_eq!(url, "wss://custom.jetstream.example/subscribe");
    }

    #[test]
    fn test_config_default() {
        let config = JetstreamConfig::default();
        assert_eq!(config.relay, DEFAULT_JETSTREAM);
        assert!(config.cursor.is_none());
        assert!(config.wanted_collections.is_empty());
    }

    #[test]
    fn test_parse_raw_event() {
        let json = r#"{
            "did": "did:plc:abc123",
            "time_us": 1704067200000000,
            "commit": {
                "rev": "abc",
                "operation": "create",
                "collection": "app.example.record",
                "rkey": "123",
                "record": {"key": "value"},
                "cid": "bafyrei..."
            }
        }"#;

        let event: RawJetstreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.did, "did:plc:abc123");
        assert!(event.commit.is_some());
        let commit = event.commit.unwrap();
        assert_eq!(commit.collection, "app.example.record");
        assert_eq!(commit.operation, "create");
    }

    #[test]
    fn test_parse_raw_event_no_commit() {
        let json = r#"{
            "did": "did:plc:abc123",
            "time_us": 1704067200000000
        }"#;

        let event: RawJetstreamEvent = serde_json::from_str(json).unwrap();
        assert!(event.commit.is_none());
    }

    #[tokio::test]
    async fn test_handle_message_emits_commit() {
        let (tx, mut rx) = mpsc::channel(10);
        let mut sub = JetstreamSubscription::new(JetstreamConfig::default(), tx);

        let msg = r#"{
            "did": "did:plc:abc123",
            "time_us": 1704067200000000,
            "commit": {
                "rev": "abc",
                "operation": "create",
                "collection": "app.example.record",
                "rkey": "123",
                "record": {"key": "value"},
                "cid": "bafyrei..."
            }
        }"#;
        sub.handle_message(msg).await.unwrap();

        let event = rx.try_recv().unwrap();
        match event {
            JetstreamEvent::Commit(commit) => {
                assert_eq!(commit.did, "did:plc:abc123");
                assert_eq!(commit.collection, "app.example.record");
                assert_eq!(commit.rkey, "123");
                assert_eq!(commit.operation, "create");
                assert_eq!(commit.uri, "at://did:plc:abc123/app.example.record/123");
            }
            _ => panic!("Expected Commit event"),
        }
    }
}
