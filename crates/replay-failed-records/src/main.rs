//! One-shot CLI that replays rows from `ingester.failed_records` back through
//! the normal upsert path.
//!
//! Why this exists: when tap-ingester can't persist a record (parse failure,
//! FK violation, etc.) and the cross-repo resolver has nothing to do,
//! `main.rs` writes the original payload to `failed_records` and acks the
//! event to Tap. Tap considers the event delivered and won't re-emit it.
//! After a fix lands that would unblock the record (e.g. PR #511 making
//! occurrence coordinates optional), the only way to re-process those
//! events is from the ledger.
//!
//! Approach: read each row's `record_json`, dispatch by `collection` through
//! the matching `observing_db::processing::*_from_json` parser, hand the
//! result to the per-table `upsert` helper, and DELETE the ledger row on
//! success. Failures are logged and left in the ledger for inspection.
//!
//! Intentionally bypasses the tap-ingester wrappers: skips media resolution
//! and notification creation. Those are live-firehose concerns, not replay
//! concerns. The architecture comment on `failed_records.rs` spells this
//! out: "a future replay job can iterate the ledger and call the
//! appropriate processing::*_from_json + upsert directly".

use chrono::{DateTime, Utc};
use clap::Parser;
use observing_db::{comments, identifications, interactions, likes, occurrences, processing};
use serde_json::Value;
use sqlx::postgres::{PgPool, PgPoolOptions};
use std::process::ExitCode;
use std::time::Duration;
use tracing::{error, info, warn};
use tracing_subscriber::{prelude::*, EnvFilter};

// Duplicated from tap-ingester::types because tap-ingester is a bin-only
// crate with no library target to import from. Keep in sync if either side
// changes.
const OCCURRENCE_COLLECTION: &str = "bio.lexicons.temp.v0-1.occurrence";
const IDENTIFICATION_COLLECTION: &str = "bio.lexicons.temp.v0-1.identification";
const COMMENT_COLLECTION: &str = "ing.observ.temp.comment";
const INTERACTION_COLLECTION: &str = "ing.observ.temp.interaction";
const LIKE_COLLECTION: &str = "ing.observ.temp.like";

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    /// Print what would be replayed without writing to the database.
    #[arg(long)]
    dry_run: bool,

    /// Cap on rows to process this run. Unbounded if omitted.
    #[arg(long)]
    limit: Option<i64>,

    /// Only replay rows whose `collection` matches this NSID exactly.
    /// Useful for verifying behavior on one collection before running the
    /// full sweep.
    #[arg(long)]
    collection: Option<String>,
}

struct FailedRow {
    uri: String,
    collection: String,
    did: String,
    cid: Option<String>,
    action: String,
    record_json: Option<Value>,
    last_attempt_at: DateTime<Utc>,
}

#[tokio::main]
async fn main() -> ExitCode {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("replay_failed_records=info"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .init();

    let args = Args::parse();

    let database_url = match std::env::var("DATABASE_URL") {
        Ok(v) => v,
        Err(_) => {
            error!("DATABASE_URL is required");
            return ExitCode::from(2);
        }
    };

    let pool = match PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(30))
        .connect(&database_url)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            error!(error = %e, "failed to connect");
            return ExitCode::from(1);
        }
    };

    match run(&pool, &args).await {
        Ok(summary) => {
            info!(
                replayed = summary.replayed,
                failed = summary.failed,
                skipped = summary.skipped,
                "done"
            );
            ExitCode::SUCCESS
        }
        Err(e) => {
            error!(error = %e, "fatal error");
            ExitCode::from(1)
        }
    }
}

#[derive(Default, Debug)]
struct Summary {
    replayed: u64,
    failed: u64,
    skipped: u64,
}

async fn run(pool: &PgPool, args: &Args) -> Result<Summary, sqlx::Error> {
    // Occurrences first so children referencing them via subject_uri don't
    // FK-violate within this same run. Within each group, oldest first so
    // multiple updates to the same URI replay in chronological order
    // (upserts are idempotent, but ordering keeps the final state honest).
    let rows = sqlx::query_as!(
        FailedRow,
        r#"
        SELECT uri, collection, did, cid, action,
               record_json,
               last_attempt_at as "last_attempt_at!: DateTime<Utc>"
        FROM ingester.failed_records
        WHERE ($1::text IS NULL OR collection = $1)
        ORDER BY
            (collection = 'bio.lexicons.temp.v0-1.occurrence') DESC,
            first_attempt_at ASC
        LIMIT COALESCE($2, 9223372036854775807)
        "#,
        args.collection.as_deref(),
        args.limit,
    )
    .fetch_all(pool)
    .await?;

    info!(candidates = rows.len(), "rows to consider");

    let mut summary = Summary::default();
    for row in rows {
        match replay_one(pool, &row, args.dry_run).await {
            ReplayOutcome::Replayed => summary.replayed += 1,
            ReplayOutcome::Skipped(reason) => {
                info!(uri = %row.uri, %reason, "skipped");
                summary.skipped += 1;
            }
            ReplayOutcome::Failed(err) => {
                warn!(uri = %row.uri, error = %err, "replay failed");
                summary.failed += 1;
            }
        }
    }

    Ok(summary)
}

enum ReplayOutcome {
    Replayed,
    Skipped(String),
    Failed(String),
}

async fn replay_one(pool: &PgPool, row: &FailedRow, dry_run: bool) -> ReplayOutcome {
    // Deletes don't carry a record_json and don't need parsing — replaying
    // them is just re-issuing the DELETE, which is idempotent. Worth doing
    // if we ever ledger delete failures, but for now treat as skipped so
    // the operator can spot them.
    if row.action == "delete" {
        return ReplayOutcome::Skipped("action=delete".into());
    }
    let Some(record_json) = row.record_json.as_ref() else {
        return ReplayOutcome::Skipped("record_json is NULL".into());
    };
    let cid = row.cid.clone().unwrap_or_default();

    // `last_attempt_at` stands in for the firehose commit time: it's the
    // closest signal we have to when the event was authored. Used as
    // `fallback_time` for `created_at` when the record itself lacks
    // `createdAt`.
    let fallback_time = row.last_attempt_at;

    let upsert_result: Result<(), String> = match row.collection.as_str() {
        OCCURRENCE_COLLECTION => {
            match processing::occurrence_from_json(
                record_json,
                row.uri.clone(),
                cid,
                row.did.clone(),
                fallback_time,
            ) {
                Ok(parsed) => {
                    if dry_run {
                        Ok(())
                    } else {
                        occurrences::upsert(pool, &parsed.params)
                            .await
                            .map_err(|e| e.to_string())
                    }
                }
                Err(e) => Err(format!("parse: {e}")),
            }
        }
        IDENTIFICATION_COLLECTION => {
            match processing::identification_from_json(
                record_json,
                row.uri.clone(),
                cid,
                row.did.clone(),
                fallback_time,
            ) {
                Ok(params) => {
                    if dry_run {
                        Ok(())
                    } else {
                        identifications::upsert(pool, &params)
                            .await
                            .map_err(|e| e.to_string())
                    }
                }
                Err(e) => Err(format!("parse: {e}")),
            }
        }
        COMMENT_COLLECTION => {
            match processing::comment_from_json(
                record_json,
                row.uri.clone(),
                cid,
                row.did.clone(),
                fallback_time,
            ) {
                Ok(params) => {
                    if dry_run {
                        Ok(())
                    } else {
                        comments::upsert(pool, &params)
                            .await
                            .map_err(|e| e.to_string())
                    }
                }
                Err(e) => Err(format!("parse: {e}")),
            }
        }
        INTERACTION_COLLECTION => {
            match processing::interaction_from_json(
                record_json,
                row.uri.clone(),
                cid,
                row.did.clone(),
                fallback_time,
            ) {
                Ok(params) => {
                    if dry_run {
                        Ok(())
                    } else {
                        interactions::upsert(pool, &params)
                            .await
                            .map_err(|e| e.to_string())
                    }
                }
                Err(e) => Err(format!("parse: {e}")),
            }
        }
        LIKE_COLLECTION => {
            match processing::like_from_json(
                record_json,
                row.uri.clone(),
                cid,
                row.did.clone(),
                fallback_time,
            ) {
                Ok(params) => {
                    if dry_run {
                        Ok(())
                    } else {
                        likes::create(pool, &params)
                            .await
                            .map_err(|e| e.to_string())
                    }
                }
                Err(e) => Err(format!("parse: {e}")),
            }
        }
        other => {
            return ReplayOutcome::Skipped(format!("unsupported collection: {other}"));
        }
    };

    match upsert_result {
        Ok(()) => {
            if dry_run {
                info!(uri = %row.uri, collection = %row.collection, "would replay");
                return ReplayOutcome::Replayed;
            }
            // Drop the ledger row only after the upsert lands, so a crash
            // mid-run leaves the row queued for the next pass.
            match sqlx::query!(
                "DELETE FROM ingester.failed_records WHERE uri = $1",
                row.uri
            )
            .execute(pool)
            .await
            {
                Ok(_) => {
                    info!(uri = %row.uri, collection = %row.collection, "replayed");
                    ReplayOutcome::Replayed
                }
                Err(e) => {
                    ReplayOutcome::Failed(format!("upsert succeeded but ledger delete failed: {e}"))
                }
            }
        }
        Err(e) => ReplayOutcome::Failed(e),
    }
}
