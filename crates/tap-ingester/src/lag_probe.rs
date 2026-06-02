//! Firehose lag probe — answers "how far behind wall-clock are we?".
//!
//! The heartbeat already logs the raw `firehose_cursor` (a relay sequence
//! number) and its per-tick `cursor_advance`, which together show liveness and
//! throughput. Neither gives absolute lag: a sequence number is meaningless as
//! "hours behind" without the commit time of the event at that position, and
//! only the relay knows that mapping.
//!
//! This module opens a short-lived `com.atproto.sync.subscribeRepos` connection
//! *at the current cursor*, reads the first `#commit` frame, and returns its
//! commit time. The heartbeat turns that into `lag_seconds = now - commit_time`:
//!
//! - near zero  → caught up to the live head,
//! - plateauing near ~72h → hugging the relay's retention floor (the failure
//!   mode where gap records age out before the consumer reaches them),
//! - trending down → draining backlog (a config change is helping),
//! - trending up → falling behind.
//!
//! A firehose frame is two concatenated CBOR objects: a header `{op, t}` and a
//! body. We decode the header to confirm `t == "#commit"`, then the body to
//! read its `time`. Non-commit frames (`#info` for an outdated cursor,
//! `#account`, `#identity`, …) are skipped.

use std::io::Cursor;
use std::time::Duration;

use chrono::{DateTime, Utc};
use ciborium::value::Value;
use futures_util::StreamExt;
use tokio_tungstenite::tungstenite::Message;

/// How long to wait for the relay to connect and deliver the first usable
/// frame before giving up. Bounds the heartbeat's added latency.
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);

/// Connect to `relay_url`'s firehose at `cursor` and return the commit time of
/// the first `#commit` event at (or after) that position. Returns `None` on any
/// failure (connect / timeout / decode) so the caller logs a sentinel rather
/// than disrupting the heartbeat.
///
/// `relay_url` MUST be the relay Tap itself consumes from — sequence numbers
/// are relay-specific, so probing a different relay would compare against an
/// unrelated cursor space and report nonsense.
pub async fn probe_cursor_time(relay_url: &str, cursor: i64) -> Option<DateTime<Utc>> {
    let url = format!(
        "{}/xrpc/com.atproto.sync.subscribeRepos?cursor={}",
        relay_url.trim_end_matches('/'),
        cursor
    );
    tokio::time::timeout(PROBE_TIMEOUT, read_first_commit_time(url))
        .await
        .ok()
        .flatten()
}

async fn read_first_commit_time(url: String) -> Option<DateTime<Utc>> {
    let (mut ws, _) = tokio_tungstenite::connect_async(url.as_str()).await.ok()?;
    while let Some(frame) = ws.next().await {
        let Ok(Message::Binary(bytes)) = frame else {
            continue;
        };
        if let Some(time) = decode_commit_time(&bytes) {
            // We have what we need; best-effort close so we don't leave the
            // relay streaming the whole backlog at us.
            let _ = ws.close(None).await;
            return Some(time);
        }
    }
    None
}

/// Decode a firehose frame (header object followed by body object) and return
/// the body's `time` when the header type is `#commit`. Any other frame type,
/// or a missing/unparseable `time`, yields `None`.
fn decode_commit_time(bytes: &[u8]) -> Option<DateTime<Utc>> {
    let mut reader = Cursor::new(bytes);
    let header: Value = ciborium::de::from_reader(&mut reader).ok()?;
    if map_get_str(&header, "t")? != "#commit" {
        return None;
    }
    // The body follows immediately after the header in the same frame; the
    // cursor left by the first decode is positioned at its first byte.
    let body: Value = ciborium::de::from_reader(&mut reader).ok()?;
    let time = map_get_str(&body, "time")?;
    DateTime::parse_from_rfc3339(time)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// Look up a string-valued key in a CBOR map `Value`. Ignores non-map values
/// and non-string entries (firehose bodies also carry bytes, CID tags, and
/// arrays we don't touch).
fn map_get_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .as_map()?
        .iter()
        .find(|(k, _)| k.as_text() == Some(key))
        .and_then(|(_, v)| v.as_text())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ciborium::value::Integer;

    fn encode(value: &Value) -> Vec<u8> {
        let mut buf = Vec::new();
        ciborium::ser::into_writer(value, &mut buf).expect("encode");
        buf
    }

    /// Build a firehose frame: header `{op:1, t}` concatenated with `body`.
    fn frame(t: &str, body: Value) -> Vec<u8> {
        let header = Value::Map(vec![
            (Value::Text("op".into()), Value::Integer(Integer::from(1))),
            (Value::Text("t".into()), Value::Text(t.into())),
        ]);
        let mut bytes = encode(&header);
        bytes.extend(encode(&body));
        bytes
    }

    #[test]
    fn decodes_commit_time_skipping_other_body_fields() {
        // A realistic-ish #commit body: the `time` we want plus the kinds of
        // fields a real frame carries (a CID tag, a CAR byte string, an int).
        let body = Value::Map(vec![
            (Value::Text("seq".into()), Value::Integer(Integer::from(42))),
            (
                Value::Text("commit".into()),
                Value::Tag(42, Box::new(Value::Bytes(vec![1, 2, 3]))),
            ),
            (Value::Text("blocks".into()), Value::Bytes(vec![0, 1, 2, 3])),
            (
                Value::Text("time".into()),
                Value::Text("2026-05-31T22:28:44.877Z".into()),
            ),
        ]);
        let got = decode_commit_time(&frame("#commit", body)).expect("commit time");
        assert_eq!(
            got.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "2026-05-31T22:28:44.877Z"
        );
    }

    #[test]
    fn ignores_non_commit_frames() {
        // e.g. the #info frame the relay sends when the cursor is outdated.
        let body = Value::Map(vec![(
            Value::Text("name".into()),
            Value::Text("OutdatedCursor".into()),
        )]);
        assert!(decode_commit_time(&frame("#info", body)).is_none());
    }

    #[test]
    fn none_when_time_missing() {
        let body = Value::Map(vec![(
            Value::Text("seq".into()),
            Value::Integer(Integer::from(7)),
        )]);
        assert!(decode_commit_time(&frame("#commit", body)).is_none());
    }
}
