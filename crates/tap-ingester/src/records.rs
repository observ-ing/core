//! Record dispatch: routes one create/update/delete in an observ.ing
//! collection to its `Database` write and bumps the dashboard counters.
//!
//! Sync-source independent — each consumer converts its own event type into
//! a [`Record`] first.

use chrono::Utc;
use observing_collections::{
    COMMENT_COLLECTION, IDENTIFICATION_COLLECTION, INTERACTION_COLLECTION, LIKE_COLLECTION,
    OCCURRENCE_COLLECTION, REMARK_COLLECTION,
};
use serde_json::Value;
use tracing::{error, warn};

use crate::database::Database;
use crate::error::Result;
use crate::server::SharedState;
use crate::types::RecentEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Create,
    Update,
    Delete,
}

impl Action {
    pub fn as_str(self) -> &'static str {
        match self {
            Action::Create => "create",
            Action::Update => "update",
            Action::Delete => "delete",
        }
    }
}

/// One record event, borrowed from whichever sync source delivered it.
#[derive(Debug, Clone, Copy)]
pub struct Record<'a> {
    pub did: &'a str,
    pub collection: &'a str,
    pub rkey: &'a str,
    pub action: Action,
    pub cid: Option<&'a str>,
    /// The record body. `None` for deletes, and for a create/update whose
    /// body didn't parse as JSON (which `process_record` skips).
    pub value: Option<&'a Value>,
}

impl Record<'_> {
    pub fn uri(&self) -> String {
        format_uri(self.did, self.collection, self.rkey)
    }
}

pub async fn process_record(db: &Database, record: &Record<'_>, state: &SharedState) -> Result<()> {
    let collection = record.collection;
    let action = record.action.as_str();

    let event_type = match collection {
        OCCURRENCE_COLLECTION => "occurrence",
        IDENTIFICATION_COLLECTION => "identification",
        REMARK_COLLECTION => "remark",
        COMMENT_COLLECTION => "comment",
        INTERACTION_COLLECTION => "interaction",
        LIKE_COLLECTION => "like",
        _ => return Ok(()),
    };

    let uri = record.uri();

    let result = if record.action == Action::Delete {
        match collection {
            OCCURRENCE_COLLECTION => db.delete_occurrence(&uri).await,
            IDENTIFICATION_COLLECTION => db.delete_identification(&uri).await,
            REMARK_COLLECTION => db.delete_remark(&uri).await,
            COMMENT_COLLECTION => db.delete_comment(&uri).await,
            INTERACTION_COLLECTION => db.delete_interaction(&uri).await,
            LIKE_COLLECTION => db.delete_like(&uri).await,
            _ => unreachable!(),
        }
    } else {
        let Some(record_value) = record.value else {
            warn!(%uri, "record event without parseable JSON; skipping");
            return Ok(());
        };
        let cid = record.cid.unwrap_or("");
        let now = Utc::now();

        // Like records are filtered to occurrence-subjects only.
        if collection == LIKE_COLLECTION && !subject_uri_is_occurrence(record_value) {
            return Ok(());
        }

        match collection {
            OCCURRENCE_COLLECTION => {
                db.upsert_occurrence(record.did, &uri, cid, now, record_value)
                    .await
            }
            IDENTIFICATION_COLLECTION => {
                db.upsert_identification(record.did, &uri, cid, now, record_value)
                    .await
            }
            REMARK_COLLECTION => db.upsert_remark(record.did, &uri, cid, record_value).await,
            COMMENT_COLLECTION => {
                db.upsert_comment(record.did, &uri, cid, now, record_value)
                    .await
            }
            INTERACTION_COLLECTION => {
                db.upsert_interaction(record.did, &uri, cid, now, record_value)
                    .await
            }
            LIKE_COLLECTION => {
                db.upsert_like(record.did, &uri, cid, now, record_value)
                    .await
            }
            _ => unreachable!(),
        }
    };

    let mut s = state.write().await;
    if let Err(e) = result {
        error!(%uri, error = %e, "{} {} failed", event_type, action);
        s.stats.errors += 1;
        Err(e)
    } else {
        match event_type {
            "occurrence" => s.stats.occurrences += 1,
            "identification" => s.stats.identifications += 1,
            "remark" => s.stats.remarks += 1,
            "comment" => s.stats.comments += 1,
            "interaction" => s.stats.interactions += 1,
            "like" => s.stats.likes += 1,
            _ => {}
        }
        s.add_recent_event(RecentEvent {
            event_type: event_type.to_string(),
            action: action.to_string(),
            uri,
            time: Utc::now(),
        });
        Ok(())
    }
}

/// The AT URI of the record a dependent record points at: the strongRef
/// under `occurrence` (identifications, interactions) or `subject`
/// (comments, likes).
pub fn subject_uri(record: &Value) -> Option<&str> {
    record
        .get("occurrence")
        .and_then(|r| r.get("uri"))
        .or_else(|| record.get("subject").and_then(|r| r.get("uri")))
        .and_then(|u| u.as_str())
}

fn subject_uri_is_occurrence(record: &Value) -> bool {
    record
        .get("subject")
        .and_then(|s| s.get("uri"))
        .and_then(|u| u.as_str())
        .is_some_and(|uri| uri.contains(OCCURRENCE_COLLECTION))
}

fn format_uri(did: &str, collection: &str, rkey: &str) -> String {
    let built: std::result::Result<jacquard_common::types::string::AtUri, _> =
        jacquard_common::types::string::AtUri::from_parts_owned(did, collection, rkey);
    built
        .map(|uri| uri.as_str().to_string())
        .unwrap_or_else(|_| format!("at://{did}/{collection}/{rkey}"))
}
