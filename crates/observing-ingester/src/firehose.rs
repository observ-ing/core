//! Jetstream WebSocket client for AT Protocol
//!
//! Connects to Bluesky's Jetstream service which provides filtered firehose access.
//! Unlike the raw firehose, Jetstream filters server-side and sends JSON.

use crate::error::{IngesterError, Result};
use crate::types::{
    CommentEvent, CommitTimingInfo, IdentificationEvent, OccurrenceEvent, COMMENT_COLLECTION,
    IDENTIFICATION_COLLECTION, OCCURRENCE_COLLECTION,
};
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

/// Jetstream event structure
#[derive(Debug, Deserialize)]
struct JetstreamEvent {
    did: String,
    time_us: i64,
    commit: Option<JetstreamCommit>,
}

#[derive(Debug, Deserialize)]
struct JetstreamCommit {
    #[allow(dead_code)]
    rev: String,
    operation: String,
    collection: String,
    rkey: String,
    record: Option<serde_json::Value>,
    cid: Option<String>,
}

/// Events emitted by the firehose subscription
#[derive(Debug)]
pub enum FirehoseEvent {
    Occurrence(OccurrenceEvent),
    Identification(IdentificationEvent),
    Comment(CommentEvent),
    Commit(CommitTimingInfo),
    Connected,
    Disconnected,
    Error(String),
}

/// Configuration for the firehose subscription
pub struct FirehoseConfig {
    pub relay: String,
    pub cursor: Option<i64>,
}

impl Default for FirehoseConfig {
    fn default() -> Self {
        Self {
            relay: DEFAULT_JETSTREAM.to_string(),
            cursor: None,
        }
    }
}

/// Firehose subscription that connects to Jetstream
pub struct FirehoseSubscription {
    config: FirehoseConfig,
    event_tx: mpsc::Sender<FirehoseEvent>,
    cursor: Option<i64>,
    last_timing: Option<CommitTimingInfo>,
    last_timing_sent: Instant,
}

impl FirehoseSubscription {
    pub fn new(config: FirehoseConfig, event_tx: mpsc::Sender<FirehoseEvent>) -> Self {
        let cursor = config.cursor;
        Self {
            config,
            event_tx,
            cursor,
            last_timing: None,
            last_timing_sent: Instant::now(),
        }
    }

    /// Start the firehose subscription (runs until stopped or max reconnects)
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
                        .send(FirehoseEvent::Error(e.to_string()))
                        .await;

                    reconnect_attempts += 1;
                    if reconnect_attempts >= MAX_RECONNECT_ATTEMPTS {
                        return Err(IngesterError::MaxReconnectAttempts);
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

        let _ = self.event_tx.send(FirehoseEvent::Connected).await;
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
                    let _ = self.event_tx.send(FirehoseEvent::Disconnected).await;
                    break;
                }
                Ok(_) => {
                    // Ignore binary, ping, pong messages
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    let _ = self.event_tx.send(FirehoseEvent::Disconnected).await;
                    return Err(e.into());
                }
            }
        }

        Ok(())
    }

    fn build_url(&self) -> String {
        let mut url = self.config.relay.clone();

        // Add collection filters
        let separator = if url.contains('?') { '&' } else { '?' };
        url = format!(
            "{}{}wantedCollections={}&wantedCollections={}&wantedCollections={}",
            url, separator, OCCURRENCE_COLLECTION, IDENTIFICATION_COLLECTION, COMMENT_COLLECTION
        );

        // Add cursor if available (Jetstream uses microseconds)
        if let Some(cursor) = self.cursor {
            url = format!("{}&cursor={}", url, cursor);
        }

        url
    }

    async fn handle_message(&mut self, text: &str) -> Result<()> {
        let event: JetstreamEvent = serde_json::from_str(text)
            .map_err(|e| IngesterError::CborDecode(format!("JSON parse error: {}", e)))?;

        let time = Utc
            .timestamp_micros(event.time_us)
            .single()
            .unwrap_or_else(Utc::now);
        let seq = event.time_us; // Jetstream uses time_us as cursor

        // Update timing info periodically
        self.last_timing = Some(CommitTimingInfo { seq, time });
        if self.last_timing_sent.elapsed() >= TIMING_UPDATE_INTERVAL {
            if let Some(ref timing) = self.last_timing {
                let _ = self
                    .event_tx
                    .send(FirehoseEvent::Commit(timing.clone()))
                    .await;
            }
            self.last_timing_sent = Instant::now();
        }

        // Process commit if present
        if let Some(commit) = event.commit {
            let did = &event.did;
            let collection = &commit.collection;
            let rkey = &commit.rkey;
            let uri = format!("at://{}/{}/{}", did, collection, rkey);
            let cid = commit.cid.unwrap_or_default();

            if collection == OCCURRENCE_COLLECTION {
                let occ_event = OccurrenceEvent {
                    did: did.to_string(),
                    uri: uri.clone(),
                    cid,
                    action: commit.operation.clone(),
                    seq,
                    time,
                    record: commit.record,
                };
                debug!("[Occurrence] {}: {}", occ_event.action, occ_event.uri);
                let _ = self
                    .event_tx
                    .send(FirehoseEvent::Occurrence(occ_event))
                    .await;
            } else if collection == IDENTIFICATION_COLLECTION {
                let id_event = IdentificationEvent {
                    did: did.to_string(),
                    uri: uri.clone(),
                    cid,
                    action: commit.operation.clone(),
                    seq,
                    time,
                    record: commit.record,
                };
                debug!("[Identification] {}: {}", id_event.action, id_event.uri);
                let _ = self
                    .event_tx
                    .send(FirehoseEvent::Identification(id_event))
                    .await;
            } else if collection == COMMENT_COLLECTION {
                let comment_event = CommentEvent {
                    did: did.to_string(),
                    uri: uri.clone(),
                    cid,
                    action: commit.operation.clone(),
                    seq,
                    time,
                    record: commit.record,
                };
                debug!("[Comment] {}: {}", comment_event.action, comment_event.uri);
                let _ = self
                    .event_tx
                    .send(FirehoseEvent::Comment(comment_event))
                    .await;
            }
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
    fn test_build_url_no_cursor() {
        let (tx, _rx) = mpsc::channel(10);
        let sub = FirehoseSubscription::new(FirehoseConfig::default(), tx);
        let url = sub.build_url();
        assert!(url.contains("wantedCollections=org.rwell.test.occurrence"));
        assert!(url.contains("wantedCollections=org.rwell.test.identification"));
        assert!(!url.contains("cursor="));
    }

    #[test]
    fn test_build_url_with_cursor() {
        let (tx, _rx) = mpsc::channel(10);
        let config = FirehoseConfig {
            cursor: Some(1234567890),
            ..Default::default()
        };
        let sub = FirehoseSubscription::new(config, tx);
        let url = sub.build_url();
        assert!(url.contains("cursor=1234567890"));
    }

    #[test]
    fn test_build_url_custom_relay() {
        let (tx, _rx) = mpsc::channel(10);
        let config = FirehoseConfig {
            relay: "wss://custom.jetstream.example/subscribe".to_string(),
            cursor: None,
        };
        let sub = FirehoseSubscription::new(config, tx);
        let url = sub.build_url();
        assert!(url.starts_with("wss://custom.jetstream.example/subscribe"));
    }

    #[test]
    fn test_firehose_config_default() {
        let config = FirehoseConfig::default();
        assert_eq!(config.relay, DEFAULT_JETSTREAM);
        assert!(config.cursor.is_none());
    }

    #[test]
    fn test_parse_jetstream_event() {
        let json = r#"{
            "did": "did:plc:abc123",
            "time_us": 1704067200000000,
            "commit": {
                "rev": "abc",
                "operation": "create",
                "collection": "org.rwell.test.occurrence",
                "rkey": "123",
                "record": {"scientificName": "Quercus alba"},
                "cid": "bafyrei..."
            }
        }"#;

        let event: JetstreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.did, "did:plc:abc123");
        assert!(event.commit.is_some());
        let commit = event.commit.unwrap();
        assert_eq!(commit.collection, "org.rwell.test.occurrence");
        assert_eq!(commit.operation, "create");
    }

    #[test]
    fn test_parse_jetstream_event_no_commit() {
        let json = r#"{
            "did": "did:plc:abc123",
            "time_us": 1704067200000000
        }"#;

        let event: JetstreamEvent = serde_json::from_str(json).unwrap();
        assert!(event.commit.is_none());
    }
}
