//! Event types emitted by the Tap subscription
//!
//! Wire format reference:
//! https://github.com/bluesky-social/indigo/blob/main/cmd/tap/types.go (`MarshallableEvt`)
//!
//! Each frame from the server is JSON of the shape:
//! ```json
//! {"id": <u64>, "type": "record" | "identity",
//!  "record": {...}      // when type == "record"
//!  "identity": {...}    // when type == "identity"
//! }
//! ```

use serde::{Deserialize, Serialize};

/// Events emitted by the Tap subscription to the consumer.
#[derive(Debug, Clone)]
pub enum TapEvent {
    Record(RecordEvent),
    Identity(IdentityEvent),
    Connected,
    Disconnected,
    Error(String),
}

impl TapEvent {
    /// Outer event id, used for acknowledgement. `None` for lifecycle events.
    pub fn id(&self) -> Option<u64> {
        match self {
            TapEvent::Record(e) => Some(e.id),
            TapEvent::Identity(e) => Some(e.id),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordEvent {
    pub id: u64,
    pub live: bool,
    pub did: String,
    pub rev: String,
    pub collection: String,
    pub rkey: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityEvent {
    pub id: u64,
    pub did: String,
    pub handle: String,
    pub is_active: bool,
    pub status: String,
}

/// Wire frame: outer envelope with the event id and a payload for one of the
/// known event types.
#[derive(Debug, Deserialize)]
pub(crate) struct WireFrame {
    pub id: u64,
    #[serde(rename = "type")]
    pub kind: String,
    pub record: Option<WireRecord>,
    pub identity: Option<WireIdentity>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WireRecord {
    pub live: bool,
    pub did: String,
    pub rev: String,
    pub collection: String,
    pub rkey: String,
    pub action: String,
    pub record: Option<serde_json::Value>,
    pub cid: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WireIdentity {
    pub did: String,
    pub handle: String,
    pub is_active: bool,
    pub status: String,
}

impl WireFrame {
    /// Convert a parsed wire frame into the public event type, returning
    /// `None` for unknown event types.
    pub(crate) fn into_event(self) -> Option<TapEvent> {
        match self.kind.as_str() {
            "record" => self.record.map(|r| {
                TapEvent::Record(RecordEvent {
                    id: self.id,
                    live: r.live,
                    did: r.did,
                    rev: r.rev,
                    collection: r.collection,
                    rkey: r.rkey,
                    action: r.action,
                    record: r.record,
                    cid: r.cid,
                })
            }),
            "identity" => self.identity.map(|i| {
                TapEvent::Identity(IdentityEvent {
                    id: self.id,
                    did: i.did,
                    handle: i.handle,
                    is_active: i.is_active,
                    status: i.status,
                })
            }),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Captured live from Tap during Phase 1 sanity check (Phase 1 fixture).
    const FIXTURE_RECORD: &str = r#"{
        "id": 4,
        "type": "record",
        "record": {
            "live": false,
            "did": "did:plc:vozr2os4b4sxrxr6opde5js5",
            "rev": "3mkkilda2bz24",
            "collection": "bio.lexicons.temp.v0-1.identification",
            "rkey": "3mkkilda2bz24",
            "action": "create",
            "cid": "bafyreig3hdmup5zzyxwb6qhwoesnwnhbesxxpt7ajv5mnydsyscv7wio2e",
            "record": {
                "$type": "bio.lexicons.temp.v0-1.identification",
                "createdAt": "2026-04-15T12:00:00.000Z",
                "isAgreement": true,
                "occurrence": "at://did:plc:abc/bio.lexicons.temp.v0-1.occurrence/3xyz",
                "scientificName": "Quercus alba"
            }
        }
    }"#;

    const FIXTURE_IDENTITY: &str = r#"{
        "id": 1,
        "type": "identity",
        "identity": {
            "did": "did:plc:jh6n3ntljfhhtr4jbvrm3k5b",
            "handle": "testobserving.bsky.social",
            "is_active": true,
            "status": "active"
        }
    }"#;

    #[test]
    fn parses_record_frame() {
        let frame: WireFrame = serde_json::from_str(FIXTURE_RECORD).unwrap();
        let evt = frame.into_event().unwrap();
        let r = match evt {
            TapEvent::Record(r) => r,
            _ => panic!("expected record"),
        };
        assert_eq!(r.id, 4);
        assert_eq!(r.collection, "bio.lexicons.temp.v0-1.identification");
        assert_eq!(r.action, "create");
        assert!(!r.live);
        assert_eq!(r.cid.as_deref(), Some("bafyreig3hdmup5zzyxwb6qhwoesnwnhbesxxpt7ajv5mnydsyscv7wio2e"));
        let body = r.record.as_ref().unwrap();
        assert_eq!(body["scientificName"], "Quercus alba");
    }

    #[test]
    fn parses_identity_frame() {
        let frame: WireFrame = serde_json::from_str(FIXTURE_IDENTITY).unwrap();
        let evt = frame.into_event().unwrap();
        let i = match evt {
            TapEvent::Identity(i) => i,
            _ => panic!("expected identity"),
        };
        assert_eq!(i.id, 1);
        assert_eq!(i.handle, "testobserving.bsky.social");
        assert!(i.is_active);
        assert_eq!(i.status, "active");
    }

    #[test]
    fn delete_record_has_no_body() {
        let json = r#"{
            "id": 99,
            "type": "record",
            "record": {
                "live": true,
                "did": "did:plc:abc",
                "rev": "rev1",
                "collection": "bio.lexicons.temp.v0-1.occurrence",
                "rkey": "rk",
                "action": "delete"
            }
        }"#;
        let frame: WireFrame = serde_json::from_str(json).unwrap();
        let r = match frame.into_event().unwrap() {
            TapEvent::Record(r) => r,
            _ => panic!(),
        };
        assert_eq!(r.action, "delete");
        assert!(r.record.is_none());
        assert!(r.cid.is_none());
    }

    #[test]
    fn unknown_type_yields_none() {
        let json = r#"{"id":1,"type":"weird"}"#;
        let frame: WireFrame = serde_json::from_str(json).unwrap();
        assert!(frame.into_event().is_none());
    }

    #[test]
    fn event_id_returns_outer_id() {
        let frame: WireFrame = serde_json::from_str(FIXTURE_RECORD).unwrap();
        let evt = frame.into_event().unwrap();
        assert_eq!(evt.id(), Some(4));

        assert_eq!(TapEvent::Connected.id(), None);
    }
}
