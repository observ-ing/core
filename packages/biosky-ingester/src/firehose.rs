//! Firehose WebSocket client for AT Protocol
//!
//! Connects to an AT Protocol relay and streams commit events.

use crate::error::{IngesterError, Result};
use crate::types::{
    CommitTimingInfo, IdentificationEvent, OccurrenceEvent, IDENTIFICATION_COLLECTION,
    OCCURRENCE_COLLECTION,
};
use atrium_api::com::atproto::sync::subscribe_repos::Commit;
use atrium_repo::blockstore::{AsyncBlockStoreRead, CarStore};
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
        let (header, body_bytes) = decode_frame(data)?;

        // Check if this is a commit message
        let op = get_cbor_int(&header, "op").unwrap_or(0);
        let t = get_cbor_string(&header, "t").unwrap_or_default();

        if op == 1 && t == "#commit" {
            // Deserialize body into atrium Commit type
            let commit: Commit = serde_ipld_dagcbor::from_slice(&body_bytes)
                .map_err(|e| IngesterError::CborDecode(e.to_string()))?;
            self.handle_commit(commit).await?;
        }

        Ok(())
    }

    async fn handle_commit(&mut self, commit: Commit) -> Result<()> {
        COMMITS_PROCESSED.fetch_add(1, Ordering::Relaxed);

        let seq = commit.seq;
        let time = parse_datetime(&commit.time);

        // Store timing info locally, only send periodically to reduce overhead
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

        // First pass: check if any ops match our collections
        let has_matching_ops = commit.ops.iter().any(|op| {
            op.path
                .split('/')
                .next()
                .is_some_and(|c| c == OCCURRENCE_COLLECTION || c == IDENTIFICATION_COLLECTION)
        });

        // Early exit if no matching collections - skip expensive blocks extraction
        if !has_matching_ops {
            self.cursor = Some(seq);
            return Ok(());
        }

        let repo = commit.repo.as_str();

        // Open CAR store for block lookups
        let mut car_store = CarStore::open(Cursor::new(&commit.blocks)).await.ok();

        for op in &commit.ops {
            // Split path into collection and rkey
            let parts: Vec<&str> = op.path.splitn(2, '/').collect();
            if parts.len() != 2 {
                continue;
            }
            let collection = parts[0];
            let rkey = parts[1];

            let cid_str = op.cid.as_ref().map(|c| c.0.to_string()).unwrap_or_default();

            if collection == OCCURRENCE_COLLECTION {
                let record = extract_record_from_car(&mut car_store, &op.cid).await;
                let event = OccurrenceEvent {
                    did: repo.to_string(),
                    uri: format!("at://{}/{}/{}", repo, collection, rkey),
                    cid: cid_str.clone(),
                    action: op.action.clone(),
                    seq,
                    time,
                    record,
                };
                debug!("[Occurrence] {}: {}", event.action, event.uri);
                let _ = self.event_tx.send(FirehoseEvent::Occurrence(event)).await;
            } else if collection == IDENTIFICATION_COLLECTION {
                let record = extract_record_from_car(&mut car_store, &op.cid).await;
                let event = IdentificationEvent {
                    did: repo.to_string(),
                    uri: format!("at://{}/{}/{}", repo, collection, rkey),
                    cid: cid_str,
                    action: op.action.clone(),
                    seq,
                    time,
                    record,
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

/// Parse an atrium Datetime to chrono DateTime<Utc>
fn parse_datetime(dt: &atrium_api::types::string::Datetime) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(dt.as_str())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

/// Extract a record from CAR blocks using atrium-repo
async fn extract_record_from_car(
    car_store: &mut Option<CarStore<Cursor<&Vec<u8>>>>,
    cid: &Option<atrium_api::types::CidLink>,
) -> Option<serde_json::Value> {
    let store = car_store.as_mut()?;
    let cid = cid.as_ref()?;

    // Read the block by CID
    let block_data = store.read_block(cid.0).await.ok()?;

    // Decode the CBOR block to IPLD then to JSON
    let ipld: ipld_core::ipld::Ipld = serde_ipld_dagcbor::from_slice(&block_data).ok()?;
    ipld_to_json(&ipld)
}

/// Convert IPLD to JSON
fn ipld_to_json(ipld: &ipld_core::ipld::Ipld) -> Option<serde_json::Value> {
    use ipld_core::ipld::Ipld;

    match ipld {
        Ipld::Null => Some(serde_json::Value::Null),
        Ipld::Bool(b) => Some(serde_json::Value::Bool(*b)),
        Ipld::Integer(i) => Some(serde_json::Value::Number((*i as i64).into())),
        Ipld::Float(f) => serde_json::Number::from_f64(*f).map(serde_json::Value::Number),
        Ipld::String(s) => Some(serde_json::Value::String(s.clone())),
        Ipld::Bytes(b) => Some(serde_json::Value::String(base64_encode(b))),
        Ipld::List(arr) => {
            let json_arr: Vec<_> = arr.iter().filter_map(ipld_to_json).collect();
            Some(serde_json::Value::Array(json_arr))
        }
        Ipld::Map(map) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in map {
                if let Some(val) = ipld_to_json(v) {
                    obj.insert(k.to_string(), val);
                }
            }
            Some(serde_json::Value::Object(obj))
        }
        Ipld::Link(cid) => Some(serde_json::Value::String(cid.to_string())),
    }
}

/// Decode an AT Protocol firehose frame (header + body as sequential CBOR values)
/// Returns the header as CborValue and the raw body bytes for typed deserialization
fn decode_frame(data: &[u8]) -> Result<(CborValue, Vec<u8>)> {
    let mut cursor = Cursor::new(data);

    let header: CborValue =
        ciborium::from_reader(&mut cursor).map_err(|e| IngesterError::CborDecode(e.to_string()))?;

    // Return remaining bytes as body for typed deserialization
    let pos = cursor.position() as usize;
    let body_bytes = data[pos..].to_vec();

    Ok((header, body_bytes))
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

/// Simple base64 encoding
fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(data.len().div_ceil(3) * 4);

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
        assert!(encoded
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='));
    }

    #[test]
    fn test_get_cbor_string_from_map() {
        let map = CborValue::Map(vec![
            (
                CborValue::Text("key1".to_string()),
                CborValue::Text("value1".to_string()),
            ),
            (
                CborValue::Text("key2".to_string()),
                CborValue::Text("value2".to_string()),
            ),
        ]);

        assert_eq!(get_cbor_string(&map, "key1"), Some("value1".to_string()));
        assert_eq!(get_cbor_string(&map, "key2"), Some("value2".to_string()));
        assert_eq!(get_cbor_string(&map, "nonexistent"), None);
    }

    #[test]
    fn test_get_cbor_string_wrong_type() {
        let map = CborValue::Map(vec![(
            CborValue::Text("number".to_string()),
            CborValue::Integer(42.into()),
        )]);

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
            (
                CborValue::Text("seq".to_string()),
                CborValue::Integer(12345.into()),
            ),
            (
                CborValue::Text("negative".to_string()),
                CborValue::Integer((-100).into()),
            ),
        ]);

        assert_eq!(get_cbor_int(&map, "seq"), Some(12345));
        assert_eq!(get_cbor_int(&map, "negative"), Some(-100));
        assert_eq!(get_cbor_int(&map, "nonexistent"), None);
    }

    #[test]
    fn test_get_cbor_int_wrong_type() {
        let map = CborValue::Map(vec![(
            CborValue::Text("string".to_string()),
            CborValue::Text("not a number".to_string()),
        )]);

        assert_eq!(get_cbor_int(&map, "string"), None);
    }

    #[test]
    fn test_get_cbor_int_non_map() {
        let int = CborValue::Integer(42.into());
        assert_eq!(get_cbor_int(&int, "key"), None);
    }

    #[test]
    fn test_decode_frame_valid() {
        // Create a simple valid frame with header and body
        let mut frame_data = Vec::new();

        // Encode header as CBOR map
        let header = CborValue::Map(vec![
            (
                CborValue::Text("op".to_string()),
                CborValue::Integer(1.into()),
            ),
            (
                CborValue::Text("t".to_string()),
                CborValue::Text("#commit".to_string()),
            ),
        ]);
        ciborium::into_writer(&header, &mut frame_data).unwrap();

        // Encode body as CBOR map
        let body = CborValue::Map(vec![
            (
                CborValue::Text("repo".to_string()),
                CborValue::Text("did:plc:test".to_string()),
            ),
            (
                CborValue::Text("seq".to_string()),
                CborValue::Integer(100.into()),
            ),
        ]);
        ciborium::into_writer(&body, &mut frame_data).unwrap();

        let result = decode_frame(&frame_data);
        assert!(result.is_ok());

        let (decoded_header, body_bytes) = result.unwrap();
        assert_eq!(get_cbor_int(&decoded_header, "op"), Some(1));
        assert_eq!(
            get_cbor_string(&decoded_header, "t"),
            Some("#commit".to_string())
        );

        // Verify body bytes can be decoded
        let decoded_body: CborValue = ciborium::from_reader(&body_bytes[..]).unwrap();
        assert_eq!(
            get_cbor_string(&decoded_body, "repo"),
            Some("did:plc:test".to_string())
        );
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
}
