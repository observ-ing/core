//! Firehose WebSocket client for AT Protocol
//!
//! Connects to an AT Protocol relay and streams commit events.

use crate::error::{IngesterError, Result};
use crate::types::{
    CommitTimingInfo, IdentificationEvent, OccurrenceEvent, OpAction,
    IDENTIFICATION_COLLECTION, OCCURRENCE_COLLECTION,
};
use chrono::{DateTime, Utc};
use ciborium::Value as CborValue;
use futures_util::StreamExt;
use std::io::Cursor;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, warn};

const DEFAULT_RELAY: &str = "wss://bsky.network";
const MAX_RECONNECT_ATTEMPTS: u32 = 10;
const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(1);

/// Events emitted by the firehose subscription
#[derive(Debug)]
pub enum FirehoseEvent {
    Occurrence(OccurrenceEvent),
    Identification(IdentificationEvent),
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
            relay: DEFAULT_RELAY.to_string(),
            cursor: None,
        }
    }
}

/// Firehose subscription that connects to the AT Protocol relay
pub struct FirehoseSubscription {
    config: FirehoseConfig,
    event_tx: mpsc::Sender<FirehoseEvent>,
    cursor: Option<i64>,
}

impl FirehoseSubscription {
    pub fn new(config: FirehoseConfig, event_tx: mpsc::Sender<FirehoseEvent>) -> Self {
        let cursor = config.cursor;
        Self {
            config,
            event_tx,
            cursor,
        }
    }

    /// Start the firehose subscription (runs until stopped or max reconnects)
    pub async fn run(&mut self) -> Result<()> {
        let mut reconnect_attempts = 0;

        loop {
            match self.connect_and_stream().await {
                Ok(()) => {
                    // Clean disconnect
                    info!("Firehose connection closed cleanly");
                    break;
                }
                Err(e) => {
                    error!("Firehose error: {}", e);
                    let _ = self.event_tx.send(FirehoseEvent::Error(e.to_string())).await;

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
        info!("Connecting to firehose: {}", url);

        let (ws_stream, _) = connect_async(&url).await?;
        let (mut _write, mut read) = ws_stream.split();

        let _ = self.event_tx.send(FirehoseEvent::Connected).await;
        info!("Firehose connection established");

        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Binary(data)) => {
                    if let Err(e) = self.handle_message(&data).await {
                        debug!("Error processing message: {}", e);
                    }
                }
                Ok(Message::Close(_)) => {
                    info!("Received close frame");
                    let _ = self.event_tx.send(FirehoseEvent::Disconnected).await;
                    break;
                }
                Ok(_) => {
                    // Ignore text, ping, pong messages
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
        let base = format!(
            "{}/xrpc/com.atproto.sync.subscribeRepos",
            self.config.relay
        );
        match self.cursor {
            Some(cursor) => format!("{}?cursor={}", base, cursor),
            None => base,
        }
    }

    async fn handle_message(&mut self, data: &[u8]) -> Result<()> {
        let (header, body) = decode_frame(data)?;

        // Check if this is a commit message
        let op = get_cbor_int(&header, "op").unwrap_or(0);
        let t = get_cbor_string(&header, "t").unwrap_or_default();

        if op == 1 && t == "#commit" {
            self.handle_commit(body).await?;
        }

        Ok(())
    }

    async fn handle_commit(&mut self, body: CborValue) -> Result<()> {
        let repo = get_cbor_string(&body, "repo").unwrap_or_default();
        let seq = get_cbor_int(&body, "seq").unwrap_or(0);
        let time_str = get_cbor_string(&body, "time").unwrap_or_default();
        let blocks = get_cbor_bytes(&body, "blocks");

        let time = DateTime::parse_from_rfc3339(&time_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());

        // Emit commit timing info for lag tracking
        let _ = self
            .event_tx
            .send(FirehoseEvent::Commit(CommitTimingInfo { seq, time }))
            .await;

        // Parse operations
        let ops = get_cbor_array(&body, "ops").unwrap_or_default();

        for op_value in ops {
            let action_str = get_cbor_string(&op_value, "action").unwrap_or_default();
            let path = get_cbor_string(&op_value, "path").unwrap_or_default();
            let cid = get_cbor_cid(&op_value, "cid");

            let action = match action_str.as_str() {
                "create" => OpAction::Create,
                "update" => OpAction::Update,
                "delete" => OpAction::Delete,
                _ => continue,
            };

            // Split path into collection and rkey
            let parts: Vec<&str> = path.splitn(2, '/').collect();
            if parts.len() != 2 {
                continue;
            }
            let collection = parts[0];
            let rkey = parts[1];

            if collection == OCCURRENCE_COLLECTION {
                let event = OccurrenceEvent {
                    did: repo.clone(),
                    uri: format!("at://{}/{}/{}", repo, collection, rkey),
                    cid: cid.clone().unwrap_or_default(),
                    action: action.as_str().to_string(),
                    seq,
                    time,
                    record: extract_record(&blocks, &cid),
                };
                debug!("[Occurrence] {}: {}", event.action, event.uri);
                let _ = self.event_tx.send(FirehoseEvent::Occurrence(event)).await;
            } else if collection == IDENTIFICATION_COLLECTION {
                let event = IdentificationEvent {
                    did: repo.clone(),
                    uri: format!("at://{}/{}/{}", repo, collection, rkey),
                    cid: cid.clone().unwrap_or_default(),
                    action: action.as_str().to_string(),
                    seq,
                    time,
                    record: extract_record(&blocks, &cid),
                };
                debug!("[Identification] {}: {}", event.action, event.uri);
                let _ = self
                    .event_tx
                    .send(FirehoseEvent::Identification(event))
                    .await;
            }
        }

        // Update cursor for resumption
        self.cursor = Some(seq);

        Ok(())
    }

    #[allow(dead_code)]
    pub fn get_cursor(&self) -> Option<i64> {
        self.cursor
    }
}

/// Decode an AT Protocol firehose frame (header + body as sequential CBOR values)
fn decode_frame(data: &[u8]) -> Result<(CborValue, CborValue)> {
    let mut cursor = Cursor::new(data);

    let header: CborValue =
        ciborium::from_reader(&mut cursor).map_err(|e| IngesterError::CborDecode(e.to_string()))?;

    let body: CborValue =
        ciborium::from_reader(&mut cursor).map_err(|e| IngesterError::CborDecode(e.to_string()))?;

    Ok((header, body))
}

/// Extract a string value from a CBOR map
fn get_cbor_string(value: &CborValue, key: &str) -> Option<String> {
    match value {
        CborValue::Map(map) => {
            for (k, v) in map {
                if let CborValue::Text(k_str) = k {
                    if k_str == key {
                        if let CborValue::Text(s) = v {
                            return Some(s.clone());
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}

/// Extract an integer value from a CBOR map
fn get_cbor_int(value: &CborValue, key: &str) -> Option<i64> {
    match value {
        CborValue::Map(map) => {
            for (k, v) in map {
                if let CborValue::Text(k_str) = k {
                    if k_str == key {
                        return match v {
                            CborValue::Integer(i) => Some((*i).try_into().unwrap_or(0)),
                            _ => None,
                        };
                    }
                }
            }
            None
        }
        _ => None,
    }
}

/// Extract a bytes value from a CBOR map
fn get_cbor_bytes(value: &CborValue, key: &str) -> Option<Vec<u8>> {
    match value {
        CborValue::Map(map) => {
            for (k, v) in map {
                if let CborValue::Text(k_str) = k {
                    if k_str == key {
                        if let CborValue::Bytes(b) = v {
                            return Some(b.clone());
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}

/// Extract an array value from a CBOR map
fn get_cbor_array(value: &CborValue, key: &str) -> Option<Vec<CborValue>> {
    match value {
        CborValue::Map(map) => {
            for (k, v) in map {
                if let CborValue::Text(k_str) = k {
                    if k_str == key {
                        if let CborValue::Array(arr) = v {
                            return Some(arr.clone());
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}

/// Extract a CID from a CBOR map (CIDs are encoded as tagged byte strings)
fn get_cbor_cid(value: &CborValue, key: &str) -> Option<String> {
    match value {
        CborValue::Map(map) => {
            for (k, v) in map {
                if let CborValue::Text(k_str) = k {
                    if k_str == key {
                        // CID is typically a tagged value (tag 42) containing bytes
                        if let CborValue::Tag(42, inner) = v {
                            if let CborValue::Bytes(bytes) = inner.as_ref() {
                                // Skip the multibase prefix byte and encode as base32
                                if bytes.len() > 1 {
                                    return Some(base32_encode(&bytes[1..]));
                                }
                            }
                        }
                        // Sometimes it might just be bytes
                        if let CborValue::Bytes(bytes) = v {
                            if bytes.len() > 1 {
                                return Some(base32_encode(&bytes[1..]));
                            }
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}

/// Simple base32 encoding for CIDs (lowercase, no padding)
fn base32_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz234567";
    let mut result = String::with_capacity((data.len() * 8 + 4) / 5);

    let mut bits: u64 = 0;
    let mut num_bits = 0;

    for &byte in data {
        bits = (bits << 8) | (byte as u64);
        num_bits += 8;

        while num_bits >= 5 {
            num_bits -= 5;
            let idx = ((bits >> num_bits) & 0x1f) as usize;
            result.push(ALPHABET[idx] as char);
        }
    }

    if num_bits > 0 {
        let idx = ((bits << (5 - num_bits)) & 0x1f) as usize;
        result.push(ALPHABET[idx] as char);
    }

    // Add CIDv1 prefix
    format!("b{}", result)
}

/// Extract a record from the CAR blocks (simplified - just decode what we can)
fn extract_record(blocks: &Option<Vec<u8>>, _cid: &Option<String>) -> Option<serde_json::Value> {
    // In a full implementation, we'd parse the CAR format and look up by CID
    // For now, attempt to decode the blocks as CBOR and convert to JSON
    let blocks = blocks.as_ref()?;

    // Skip CAR header (first CBOR value) and try to decode the block
    let mut cursor = Cursor::new(blocks);

    // Skip header
    let _: CborValue = ciborium::from_reader(&mut cursor).ok()?;

    // Try to decode next value as the record
    let record: CborValue = ciborium::from_reader(&mut cursor).ok()?;
    cbor_to_json(&record)
}

/// Convert CBOR value to JSON (best effort)
fn cbor_to_json(value: &CborValue) -> Option<serde_json::Value> {
    match value {
        CborValue::Null => Some(serde_json::Value::Null),
        CborValue::Bool(b) => Some(serde_json::Value::Bool(*b)),
        CborValue::Integer(i) => {
            let n: i64 = (*i).try_into().ok()?;
            Some(serde_json::Value::Number(n.into()))
        }
        CborValue::Float(f) => serde_json::Number::from_f64(*f).map(serde_json::Value::Number),
        CborValue::Text(s) => Some(serde_json::Value::String(s.clone())),
        CborValue::Bytes(b) => Some(serde_json::Value::String(base64_encode(b))),
        CborValue::Array(arr) => {
            let json_arr: Vec<_> = arr.iter().filter_map(cbor_to_json).collect();
            Some(serde_json::Value::Array(json_arr))
        }
        CborValue::Map(map) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in map {
                if let CborValue::Text(key) = k {
                    if let Some(val) = cbor_to_json(v) {
                        obj.insert(key.clone(), val);
                    }
                }
            }
            Some(serde_json::Value::Object(obj))
        }
        CborValue::Tag(_, inner) => cbor_to_json(inner),
        _ => None,
    }
}

/// Simple base64 encoding
fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);

    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;

        result.push(ALPHABET[b0 >> 2] as char);
        result.push(ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)] as char);

        if chunk.len() > 1 {
            result.push(ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(ALPHABET[b2 & 0x3f] as char);
        } else {
            result.push('=');
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_url_no_cursor() {
        let (tx, _rx) = mpsc::channel(10);
        let sub = FirehoseSubscription::new(FirehoseConfig::default(), tx);
        let url = sub.build_url();
        assert_eq!(
            url,
            "wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos"
        );
    }

    #[test]
    fn test_build_url_with_cursor() {
        let (tx, _rx) = mpsc::channel(10);
        let config = FirehoseConfig {
            cursor: Some(12345),
            ..Default::default()
        };
        let sub = FirehoseSubscription::new(config, tx);
        let url = sub.build_url();
        assert_eq!(
            url,
            "wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos?cursor=12345"
        );
    }

    #[test]
    fn test_base32_encode() {
        // Simple test
        let encoded = base32_encode(&[0x01, 0x71]);
        assert!(encoded.starts_with('b'));
    }

    #[test]
    fn test_base64_encode() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
        assert_eq!(base64_encode(b"a"), "YQ==");
        assert_eq!(base64_encode(b"ab"), "YWI=");
        assert_eq!(base64_encode(b"abc"), "YWJj");
    }
}
