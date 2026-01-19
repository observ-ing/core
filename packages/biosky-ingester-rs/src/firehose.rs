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
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, warn};

const TIMING_UPDATE_INTERVAL: Duration = Duration::from_secs(5);
const STATS_LOG_INTERVAL: Duration = Duration::from_secs(10);

/// Diagnostic counters for throughput monitoring
static MESSAGES_RECEIVED: AtomicU64 = AtomicU64::new(0);
static COMMITS_PROCESSED: AtomicU64 = AtomicU64::new(0);

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

        // Reset diagnostic counters
        MESSAGES_RECEIVED.store(0, Ordering::Relaxed);
        COMMITS_PROCESSED.store(0, Ordering::Relaxed);
        let mut last_stats_log = Instant::now();

        while let Some(msg) = read.next().await {
            // Log throughput stats periodically
            if last_stats_log.elapsed() >= STATS_LOG_INTERVAL {
                let msgs = MESSAGES_RECEIVED.swap(0, Ordering::Relaxed);
                let commits = COMMITS_PROCESSED.swap(0, Ordering::Relaxed);
                let elapsed = last_stats_log.elapsed().as_secs_f64();
                info!(
                    "Throughput: {:.1} msgs/sec, {:.1} commits/sec",
                    msgs as f64 / elapsed,
                    commits as f64 / elapsed
                );
                last_stats_log = Instant::now();
            }

            match msg {
                Ok(Message::Binary(data)) => {
                    MESSAGES_RECEIVED.fetch_add(1, Ordering::Relaxed);
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
        COMMITS_PROCESSED.fetch_add(1, Ordering::Relaxed);

        let repo = get_cbor_string(&body, "repo").unwrap_or_default();
        let seq = get_cbor_int(&body, "seq").unwrap_or(0);
        let time_str = get_cbor_string(&body, "time").unwrap_or_default();
        let blocks = get_cbor_bytes(&body, "blocks");

        let time = DateTime::parse_from_rfc3339(&time_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());

        // Store timing info locally, only send periodically to reduce overhead
        self.last_timing = Some(CommitTimingInfo { seq, time });
        if self.last_timing_sent.elapsed() >= TIMING_UPDATE_INTERVAL {
            if let Some(ref timing) = self.last_timing {
                let _ = self.event_tx.send(FirehoseEvent::Commit(timing.clone())).await;
            }
            self.last_timing_sent = Instant::now();
        }

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
    fn test_build_url_custom_relay() {
        let (tx, _rx) = mpsc::channel(10);
        let config = FirehoseConfig {
            relay: "wss://custom.relay.example".to_string(),
            cursor: None,
        };
        let sub = FirehoseSubscription::new(config, tx);
        let url = sub.build_url();
        assert_eq!(
            url,
            "wss://custom.relay.example/xrpc/com.atproto.sync.subscribeRepos"
        );
    }

    #[test]
    fn test_firehose_config_default() {
        let config = FirehoseConfig::default();
        assert_eq!(config.relay, "wss://bsky.network");
        assert!(config.cursor.is_none());
    }

    #[test]
    fn test_get_cursor() {
        let (tx, _rx) = mpsc::channel(10);
        let config = FirehoseConfig {
            cursor: Some(999),
            ..Default::default()
        };
        let sub = FirehoseSubscription::new(config, tx);
        assert_eq!(sub.get_cursor(), Some(999));
    }

    #[test]
    fn test_base32_encode() {
        // Simple test
        let encoded = base32_encode(&[0x01, 0x71]);
        assert!(encoded.starts_with('b'));
    }

    #[test]
    fn test_base32_encode_empty() {
        let encoded = base32_encode(&[]);
        assert_eq!(encoded, "b");
    }

    #[test]
    fn test_base32_encode_single_byte() {
        let encoded = base32_encode(&[0xff]);
        assert!(encoded.starts_with('b'));
        assert!(encoded.len() > 1);
    }

    #[test]
    fn test_base64_encode() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
        assert_eq!(base64_encode(b"a"), "YQ==");
        assert_eq!(base64_encode(b"ab"), "YWI=");
        assert_eq!(base64_encode(b"abc"), "YWJj");
    }

    #[test]
    fn test_base64_encode_empty() {
        assert_eq!(base64_encode(&[]), "");
    }

    #[test]
    fn test_base64_encode_binary() {
        // Test with binary data (all possible byte values in small range)
        let data: Vec<u8> = (0..=255u8).take(6).collect();
        let encoded = base64_encode(&data);
        assert!(!encoded.is_empty());
        // Should only contain valid base64 characters
        assert!(encoded.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='));
    }

    #[test]
    fn test_get_cbor_string_from_map() {
        let map = CborValue::Map(vec![
            (CborValue::Text("key1".to_string()), CborValue::Text("value1".to_string())),
            (CborValue::Text("key2".to_string()), CborValue::Text("value2".to_string())),
        ]);

        assert_eq!(get_cbor_string(&map, "key1"), Some("value1".to_string()));
        assert_eq!(get_cbor_string(&map, "key2"), Some("value2".to_string()));
        assert_eq!(get_cbor_string(&map, "nonexistent"), None);
    }

    #[test]
    fn test_get_cbor_string_wrong_type() {
        let map = CborValue::Map(vec![
            (CborValue::Text("number".to_string()), CborValue::Integer(42.into())),
        ]);

        assert_eq!(get_cbor_string(&map, "number"), None);
    }

    #[test]
    fn test_get_cbor_string_non_map() {
        let array = CborValue::Array(vec![CborValue::Text("item".to_string())]);
        assert_eq!(get_cbor_string(&array, "key"), None);

        let text = CborValue::Text("just a string".to_string());
        assert_eq!(get_cbor_string(&text, "key"), None);
    }

    #[test]
    fn test_get_cbor_int_from_map() {
        let map = CborValue::Map(vec![
            (CborValue::Text("seq".to_string()), CborValue::Integer(12345.into())),
            (CborValue::Text("negative".to_string()), CborValue::Integer((-100).into())),
        ]);

        assert_eq!(get_cbor_int(&map, "seq"), Some(12345));
        assert_eq!(get_cbor_int(&map, "negative"), Some(-100));
        assert_eq!(get_cbor_int(&map, "nonexistent"), None);
    }

    #[test]
    fn test_get_cbor_int_wrong_type() {
        let map = CborValue::Map(vec![
            (CborValue::Text("string".to_string()), CborValue::Text("not a number".to_string())),
        ]);

        assert_eq!(get_cbor_int(&map, "string"), None);
    }

    #[test]
    fn test_get_cbor_int_non_map() {
        let int = CborValue::Integer(42.into());
        assert_eq!(get_cbor_int(&int, "key"), None);
    }

    #[test]
    fn test_get_cbor_bytes_from_map() {
        let map = CborValue::Map(vec![
            (CborValue::Text("data".to_string()), CborValue::Bytes(vec![1, 2, 3, 4])),
        ]);

        assert_eq!(get_cbor_bytes(&map, "data"), Some(vec![1, 2, 3, 4]));
        assert_eq!(get_cbor_bytes(&map, "nonexistent"), None);
    }

    #[test]
    fn test_get_cbor_bytes_wrong_type() {
        let map = CborValue::Map(vec![
            (CborValue::Text("text".to_string()), CborValue::Text("not bytes".to_string())),
        ]);

        assert_eq!(get_cbor_bytes(&map, "text"), None);
    }

    #[test]
    fn test_get_cbor_array_from_map() {
        let inner_array = vec![
            CborValue::Text("item1".to_string()),
            CborValue::Text("item2".to_string()),
        ];
        let map = CborValue::Map(vec![
            (CborValue::Text("ops".to_string()), CborValue::Array(inner_array.clone())),
        ]);

        let result = get_cbor_array(&map, "ops");
        assert!(result.is_some());
        assert_eq!(result.unwrap().len(), 2);
        assert_eq!(get_cbor_array(&map, "nonexistent"), None);
    }

    #[test]
    fn test_get_cbor_array_wrong_type() {
        let map = CborValue::Map(vec![
            (CborValue::Text("text".to_string()), CborValue::Text("not an array".to_string())),
        ]);

        assert_eq!(get_cbor_array(&map, "text"), None);
    }

    #[test]
    fn test_cbor_to_json_null() {
        let result = cbor_to_json(&CborValue::Null);
        assert_eq!(result, Some(serde_json::Value::Null));
    }

    #[test]
    fn test_cbor_to_json_bool() {
        assert_eq!(cbor_to_json(&CborValue::Bool(true)), Some(serde_json::json!(true)));
        assert_eq!(cbor_to_json(&CborValue::Bool(false)), Some(serde_json::json!(false)));
    }

    #[test]
    fn test_cbor_to_json_integer() {
        assert_eq!(cbor_to_json(&CborValue::Integer(42.into())), Some(serde_json::json!(42)));
        assert_eq!(cbor_to_json(&CborValue::Integer((-100).into())), Some(serde_json::json!(-100)));
    }

    #[test]
    fn test_cbor_to_json_float() {
        let result = cbor_to_json(&CborValue::Float(3.14));
        assert!(result.is_some());
        let val = result.unwrap();
        assert!(val.is_f64());
    }

    #[test]
    fn test_cbor_to_json_text() {
        let result = cbor_to_json(&CborValue::Text("hello".to_string()));
        assert_eq!(result, Some(serde_json::json!("hello")));
    }

    #[test]
    fn test_cbor_to_json_bytes() {
        let result = cbor_to_json(&CborValue::Bytes(vec![1, 2, 3]));
        assert!(result.is_some());
        // Bytes should be base64 encoded
        assert!(result.unwrap().is_string());
    }

    #[test]
    fn test_cbor_to_json_array() {
        let cbor_array = CborValue::Array(vec![
            CborValue::Integer(1.into()),
            CborValue::Integer(2.into()),
            CborValue::Integer(3.into()),
        ]);
        let result = cbor_to_json(&cbor_array);
        assert_eq!(result, Some(serde_json::json!([1, 2, 3])));
    }

    #[test]
    fn test_cbor_to_json_map() {
        let cbor_map = CborValue::Map(vec![
            (CborValue::Text("name".to_string()), CborValue::Text("test".to_string())),
            (CborValue::Text("count".to_string()), CborValue::Integer(5.into())),
        ]);
        let result = cbor_to_json(&cbor_map);
        assert!(result.is_some());
        let json = result.unwrap();
        assert_eq!(json["name"], "test");
        assert_eq!(json["count"], 5);
    }

    #[test]
    fn test_cbor_to_json_nested() {
        let nested = CborValue::Map(vec![
            (CborValue::Text("outer".to_string()), CborValue::Map(vec![
                (CborValue::Text("inner".to_string()), CborValue::Text("value".to_string())),
            ])),
        ]);
        let result = cbor_to_json(&nested);
        assert!(result.is_some());
        let json = result.unwrap();
        assert_eq!(json["outer"]["inner"], "value");
    }

    #[test]
    fn test_cbor_to_json_tagged() {
        // Tagged values should unwrap to their inner value
        let tagged = CborValue::Tag(42, Box::new(CborValue::Text("tagged content".to_string())));
        let result = cbor_to_json(&tagged);
        assert_eq!(result, Some(serde_json::json!("tagged content")));
    }

    #[test]
    fn test_decode_frame_valid() {
        // Create a simple valid frame with header and body
        let mut frame_data = Vec::new();

        // Encode header as CBOR map
        let header = CborValue::Map(vec![
            (CborValue::Text("op".to_string()), CborValue::Integer(1.into())),
            (CborValue::Text("t".to_string()), CborValue::Text("#commit".to_string())),
        ]);
        ciborium::into_writer(&header, &mut frame_data).unwrap();

        // Encode body as CBOR map
        let body = CborValue::Map(vec![
            (CborValue::Text("repo".to_string()), CborValue::Text("did:plc:test".to_string())),
            (CborValue::Text("seq".to_string()), CborValue::Integer(100.into())),
        ]);
        ciborium::into_writer(&body, &mut frame_data).unwrap();

        let result = decode_frame(&frame_data);
        assert!(result.is_ok());

        let (decoded_header, decoded_body) = result.unwrap();
        assert_eq!(get_cbor_int(&decoded_header, "op"), Some(1));
        assert_eq!(get_cbor_string(&decoded_header, "t"), Some("#commit".to_string()));
        assert_eq!(get_cbor_string(&decoded_body, "repo"), Some("did:plc:test".to_string()));
        assert_eq!(get_cbor_int(&decoded_body, "seq"), Some(100));
    }

    #[test]
    fn test_decode_frame_invalid() {
        // Invalid CBOR data
        let invalid_data = vec![0xff, 0xff, 0xff];
        let result = decode_frame(&invalid_data);
        assert!(result.is_err());
    }

    #[test]
    fn test_decode_frame_empty() {
        let result = decode_frame(&[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_cbor_cid_tagged() {
        // CID with tag 42 and bytes (skipping first byte for multibase prefix)
        let cid_bytes = vec![0x00, 0x01, 0x71, 0x12, 0x20]; // multibase prefix + some CID bytes
        let map = CborValue::Map(vec![
            (CborValue::Text("cid".to_string()), CborValue::Tag(42, Box::new(CborValue::Bytes(cid_bytes)))),
        ]);

        let result = get_cbor_cid(&map, "cid");
        assert!(result.is_some());
        assert!(result.unwrap().starts_with('b')); // base32 CID prefix
    }

    #[test]
    fn test_get_cbor_cid_raw_bytes() {
        // CID as raw bytes (no tag)
        let cid_bytes = vec![0x00, 0x01, 0x71, 0x12, 0x20];
        let map = CborValue::Map(vec![
            (CborValue::Text("cid".to_string()), CborValue::Bytes(cid_bytes)),
        ]);

        let result = get_cbor_cid(&map, "cid");
        assert!(result.is_some());
    }

    #[test]
    fn test_get_cbor_cid_missing() {
        let map = CborValue::Map(vec![
            (CborValue::Text("other".to_string()), CborValue::Text("value".to_string())),
        ]);

        assert_eq!(get_cbor_cid(&map, "cid"), None);
    }

    #[test]
    fn test_get_cbor_cid_too_short() {
        // CID bytes too short (only 1 byte)
        let cid_bytes = vec![0x00];
        let map = CborValue::Map(vec![
            (CborValue::Text("cid".to_string()), CborValue::Tag(42, Box::new(CborValue::Bytes(cid_bytes)))),
        ]);

        assert_eq!(get_cbor_cid(&map, "cid"), None);
    }
}
