//! Cross-repo dependency resolution.
//!
//! When tap-ingester processes an identification/comment/like/interaction
//! that references an occurrence on a DID Tap isn't tracking, the
//! subject's DID is added to Tap via `/repos/add`. The current event is
//! then mem::forget'd by the caller so it isn't acked; Tap redelivers
//! after retry-timeout, and by then the foreign repo's occurrences have
//! been backfilled (within the per-repo ordering guarantee).
//!
//! De-duplication is per-process: a `HashSet` of attempted DIDs prevents
//! repeatedly POSTing the same DID. On process restart the set resets,
//! but Tap's repo-tracking is durable in its SQLite/Postgres state, so
//! a redelivered request is a no-op (Tap dedupes by DID).

use std::collections::HashSet;
use std::sync::Arc;

use serde_json::Value;
use tapped::TapClient;
use tokio::sync::RwLock;
use tracing::{info, warn};

#[derive(Clone)]
pub struct SubjectResolver {
    tap: TapClient,
    attempted: Arc<RwLock<HashSet<String>>>,
}

impl SubjectResolver {
    pub fn new(tap: TapClient) -> Self {
        Self {
            tap,
            attempted: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    /// If the record carries a strongRef subject (`record.occurrence` for
    /// identifications/interactions, `record.subject` for comments/likes),
    /// extract the DID and ensure Tap is tracking that repo. Idempotent:
    /// each DID is `/repos/add`-ed at most once per process lifetime.
    /// Returns the DID added, or `None` if there was nothing to do.
    pub async fn ensure_subject_tracked(&self, record: &Value) -> Option<String> {
        let subject_did = extract_subject_did(record)?;

        // Fast path: most events reference an already-tracked DID, so the
        // read lock lets concurrent dedup checks proceed without contention.
        if self.attempted.read().await.contains(&subject_did) {
            return None;
        }

        // Slow path: take the write lock and re-check via insert() so the
        // dedup remains atomic against concurrent first-time inserts.
        if !self.attempted.write().await.insert(subject_did.clone()) {
            return None;
        }

        match self.tap.add_repos(std::slice::from_ref(&subject_did)).await {
            Ok(_) => {
                info!(did = %subject_did, "added subject DID to Tap tracking");
                Some(subject_did)
            }
            Err(e) => {
                warn!(did = %subject_did, error = %e, "/repos/add failed");
                // Allow a later event to retry.
                self.attempted.write().await.remove(&subject_did);
                None
            }
        }
    }
}

/// Find a strongRef-shaped subject in the record (under either `occurrence`
/// or `subject`) and return the DID portion of its `uri`.
fn extract_subject_did(record: &Value) -> Option<String> {
    let uri = record
        .get("occurrence")
        .and_then(|r| r.get("uri"))
        .or_else(|| record.get("subject").and_then(|r| r.get("uri")))
        .and_then(|u| u.as_str())?;
    let stripped = uri.strip_prefix("at://")?;
    let did = stripped.split('/').next()?;
    if did.is_empty() {
        return None;
    }
    Some(did.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn identification_uses_occurrence_field() {
        let record = json!({
            "$type": "bio.lexicons.temp.v0-1.identification",
            "occurrence": {
                "uri": "at://did:plc:foo123/bio.lexicons.temp.v0-1.occurrence/3xyz",
                "cid": "bafy..."
            },
            "scientificName": "Quercus alba"
        });
        assert_eq!(
            extract_subject_did(&record).as_deref(),
            Some("did:plc:foo123")
        );
    }

    #[test]
    fn comment_uses_subject_field() {
        let record = json!({
            "$type": "ing.observ.temp.comment",
            "subject": {
                "uri": "at://did:plc:bar456/bio.lexicons.temp.v0-1.occurrence/abc",
                "cid": "bafy..."
            },
            "body": "Nice find!"
        });
        assert_eq!(
            extract_subject_did(&record).as_deref(),
            Some("did:plc:bar456")
        );
    }

    #[test]
    fn like_uses_subject_field() {
        let record = json!({
            "$type": "ing.observ.temp.like",
            "subject": {
                "uri": "at://did:plc:baz789/bio.lexicons.temp.v0-1.occurrence/xyz",
                "cid": "bafy..."
            }
        });
        assert_eq!(
            extract_subject_did(&record).as_deref(),
            Some("did:plc:baz789")
        );
    }

    #[test]
    fn interaction_uses_occurrence_field() {
        let record = json!({
            "$type": "ing.observ.temp.interaction",
            "occurrence": {
                "uri": "at://did:plc:qux/bio.lexicons.temp.v0-1.occurrence/i",
                "cid": "bafy..."
            }
        });
        assert_eq!(extract_subject_did(&record).as_deref(), Some("did:plc:qux"));
    }

    #[test]
    fn occurrence_record_has_no_subject() {
        let record = json!({
            "$type": "bio.lexicons.temp.v0-1.occurrence",
            "scientificName": "Quercus alba",
            "eventDate": "2026-04-15"
        });
        assert!(extract_subject_did(&record).is_none());
    }

    #[test]
    fn malformed_uri_returns_none() {
        let record = json!({"subject": {"uri": "not-an-at-uri"}});
        assert!(extract_subject_did(&record).is_none());
    }

    #[test]
    fn empty_did_returns_none() {
        let record = json!({"subject": {"uri": "at:///collection/rkey"}});
        assert!(extract_subject_did(&record).is_none());
    }
}
