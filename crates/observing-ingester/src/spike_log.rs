//! Tap spike: optional dual-source event log.
//!
//! When the env var `SPIKE_LOG_EVENTS=1` is set at startup, the ingester
//! writes one row to `tap_spike.event_log` per Jetstream commit it receives,
//! tagged `source = 'jetstream'`. The tap-shadow consumer writes parallel
//! rows tagged `source = 'tap'`. The schema lives in
//! `scripts/tap-spike-schema.sql`. Drop the schema to disable cleanly.

use jetstream_client::CommitInfo;
use sqlx::PgPool;
use tracing::warn;

pub fn enabled() -> bool {
    std::env::var("SPIKE_LOG_EVENTS").map(|v| v == "1").unwrap_or(false)
}

pub async fn log_jetstream_commit(pool: &PgPool, commit: &CommitInfo) {
    let cid = (!commit.cid.is_empty()).then_some(commit.cid.as_str());
    if let Err(e) = sqlx::query(
        "INSERT INTO tap_spike.event_log
            (source, did, collection, rkey, cid, action, live, tap_event_id)
         VALUES ('jetstream', $1, $2, $3, $4, $5, NULL, NULL)",
    )
    .bind(&commit.did)
    .bind(&commit.collection)
    .bind(&commit.rkey)
    .bind(cid)
    .bind(&commit.operation)
    .execute(pool)
    .await
    {
        warn!(error = %e, "spike event_log insert failed");
    }
}
