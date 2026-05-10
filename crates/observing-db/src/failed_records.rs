//! Ledger of records the ingester couldn't persist on the first try.
//!
//! See migration `20260509120000_failed_records.sql` for the table
//! shape and motivation. The ledger is write-through from
//! tap-ingester's main loop: a row exists ⇔ at least one ack-and-drop
//! happened for that URI. A subsequent successful upsert for the same
//! URI does NOT auto-clear the ledger row — entries can become stale
//! once redelivery succeeds, and an explicit cleanup pass (or admin
//! tool) prunes them. That keeps the hot write path one query instead
//! of two.
//!
//! `record_json` is stored as JSONB so a future replay job can iterate
//! the ledger and call the appropriate `processing::*_from_json` +
//! `upsert` directly without going back to the firehose.

use serde_json::Value;

/// Inputs for [`record`]. Borrowed so callers don't have to clone the
/// firehose payload just to log a failure.
pub struct FailedRecord<'a> {
    pub uri: &'a str,
    pub collection: &'a str,
    pub did: &'a str,
    pub cid: Option<&'a str>,
    pub action: &'a str,
    pub record_json: Option<&'a Value>,
    pub error: &'a str,
}

/// Upsert a failure into the ledger. On a repeat failure for the same
/// URI, bumps `attempts` and refreshes `last_attempt_at` / `last_error`
/// without touching `first_attempt_at`.
pub async fn record(
    executor: impl sqlx::PgExecutor<'_>,
    p: FailedRecord<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO failed_records (
            uri, collection, did, cid, action, record_json, last_error
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7
        )
        ON CONFLICT (uri) DO UPDATE SET
            collection      = EXCLUDED.collection,
            did             = EXCLUDED.did,
            cid             = EXCLUDED.cid,
            action          = EXCLUDED.action,
            record_json     = EXCLUDED.record_json,
            last_error      = EXCLUDED.last_error,
            attempts        = failed_records.attempts + 1,
            last_attempt_at = NOW()
        "#,
        p.uri,
        p.collection,
        p.did,
        p.cid,
        p.action,
        p.record_json,
        p.error,
    )
    .execute(executor)
    .await?;
    Ok(())
}
