//! Background task that subscribes to QuickSlice GraphQL events
//! and creates notifications / syncs co-observers in the appview database.

use quickslice_client::subscription::{self, SubscriptionEvent};
use quickslice_client::QuickSliceClient;
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{debug, error, info, warn};

/// Subscription event payload for records that reference an occurrence via `subject`.
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct SubjectRecord {
    uri: String,
    did: String,
    /// The occurrence URI from the subject strong reference, resolved by QuickSlice joins.
    #[serde(default)]
    subject_uri: Option<String>,
}

/// Subscription event payload for occurrence records.
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct OccurrenceRecord {
    uri: String,
    did: String,
    recorded_by: Option<Vec<String>>,
}

const SUB_ID_IDENTIFICATION: &str = "identification";
const SUB_ID_COMMENT: &str = "comment";
const SUB_ID_LIKE: &str = "like";
const SUB_ID_OCCURRENCE: &str = "occurrence";

/// Start the subscription background task.
///
/// This connects to QuickSlice's GraphQL WebSocket endpoint and listens for
/// new identifications, comments, likes, and occurrences. On each event it
/// creates the appropriate notification or syncs co-observers.
pub fn start(pool: PgPool, quickslice: Arc<QuickSliceClient>) {
    tokio::spawn(async move {
        let ws_url = quickslice.ws_url();
        info!(ws_url = %ws_url, "Starting QuickSlice subscription listener");

        let subscriptions = vec![
            (
                SUB_ID_IDENTIFICATION.to_string(),
                "subscription { orgRwellTestIdentificationCreated { uri did subject { uri did } } }"
                    .to_string(),
            ),
            (
                SUB_ID_COMMENT.to_string(),
                "subscription { orgRwellTestCommentCreated { uri did subject { uri did } } }"
                    .to_string(),
            ),
            (
                SUB_ID_LIKE.to_string(),
                "subscription { orgRwellTestLikeCreated { uri did subject { uri did } } }"
                    .to_string(),
            ),
            (
                SUB_ID_OCCURRENCE.to_string(),
                "subscription { orgRwellTestOccurrenceCreated { uri did recordedBy } }".to_string(),
            ),
        ];

        let mut rx = match subscription::subscribe(&ws_url, subscriptions).await {
            Ok(rx) => rx,
            Err(e) => {
                error!(error = %e, "Failed to start QuickSlice subscriptions");
                return;
            }
        };

        info!("QuickSlice subscription listener started");

        while let Some(event) = rx.recv().await {
            if let Err(e) = handle_event(&pool, &quickslice, &event).await {
                warn!(error = %e, id = %event.id, "Failed to handle subscription event");
            }
        }

        warn!("QuickSlice subscription channel closed");
    });
}

async fn handle_event(
    pool: &PgPool,
    quickslice: &QuickSliceClient,
    event: &SubscriptionEvent<serde_json::Value>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match event.id.as_str() {
        SUB_ID_IDENTIFICATION => {
            if let Some(record) = parse_subject_record(event, "orgRwellTestIdentificationCreated") {
                handle_notification(pool, quickslice, &record, "identification").await?;
            }
        }
        SUB_ID_COMMENT => {
            if let Some(record) = parse_subject_record(event, "orgRwellTestCommentCreated") {
                handle_notification(pool, quickslice, &record, "comment").await?;
            }
        }
        SUB_ID_LIKE => {
            if let Some(record) = parse_subject_record(event, "orgRwellTestLikeCreated") {
                handle_notification(pool, quickslice, &record, "like").await?;
            }
        }
        SUB_ID_OCCURRENCE => {
            if let Some(record) = parse_occurrence_record(event) {
                handle_occurrence_created(pool, &record).await?;
            }
        }
        _ => {
            debug!(id = %event.id, "Unknown subscription event");
        }
    }

    Ok(())
}

fn parse_subject_record(
    event: &SubscriptionEvent<serde_json::Value>,
    field_name: &str,
) -> Option<SubjectRecord> {
    let field_data = event.data.get(field_name)?;

    // The subject strong ref join gives us `subject: { uri, did }`
    let mut record: SubjectRecord = serde_json::from_value(field_data.clone()).ok()?;

    // Extract subject URI from the nested subject object
    if record.subject_uri.is_none() {
        if let Some(subject) = field_data.get("subject") {
            record.subject_uri = subject
                .get("uri")
                .and_then(|v| v.as_str())
                .map(String::from);
        }
    }

    Some(record)
}

fn parse_occurrence_record(
    event: &SubscriptionEvent<serde_json::Value>,
) -> Option<OccurrenceRecord> {
    subscription::parse_event(event, "orgRwellTestOccurrenceCreated")
}

/// Create a notification for an identification, comment, or like.
/// Looks up the occurrence owner DID from the subject URI.
async fn handle_notification(
    pool: &PgPool,
    quickslice: &QuickSliceClient,
    record: &SubjectRecord,
    kind: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let subject_uri = match &record.subject_uri {
        Some(uri) => uri.clone(),
        None => {
            warn!(
                record_uri = %record.uri,
                "No subject URI in subscription event, skipping notification"
            );
            return Ok(());
        }
    };

    // Look up the occurrence owner DID
    let occurrence = quickslice.get_occurrence(&subject_uri).await?;
    let owner_did = match occurrence {
        Some(occ) => occ.did,
        None => {
            debug!(
                subject_uri = %subject_uri,
                "Occurrence not found for notification, skipping"
            );
            return Ok(());
        }
    };

    // Create notification (observing_db skips self-notifications)
    observing_db::notifications::create(pool, &owner_did, &record.did, kind, &subject_uri, &record.uri).await?;

    debug!(
        kind = kind,
        actor = %record.did,
        recipient = %owner_did,
        "Created notification"
    );

    Ok(())
}

/// Sync co-observers when a new occurrence is created.
async fn handle_occurrence_created(
    pool: &PgPool,
    record: &OccurrenceRecord,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let co_observers = record.recorded_by.clone().unwrap_or_default();

    if !co_observers.is_empty() {
        observing_db::observers::sync(pool, &record.uri, &record.did, &co_observers).await?;
        debug!(
            occurrence_uri = %record.uri,
            co_observer_count = co_observers.len(),
            "Synced co-observers from subscription"
        );
    }

    Ok(())
}
