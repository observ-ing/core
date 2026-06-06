//! `replay-failed-records` task: replay rows from `ingester.failed_records`
//! back through the normal upsert path.
//!
//! Why this exists: when tap-ingester can't persist a record (parse failure,
//! FK violation, etc.) and the cross-repo resolver has nothing to do, it
//! writes the original payload to `failed_records` and acks the event to Tap.
//! Tap considers the event delivered and won't re-emit it. After a fix lands
//! that would unblock the record (e.g. PR #511 making occurrence coordinates
//! optional), the only way to re-process those events is from the ledger.
//!
//! Approach: read each row's `record_json`, dispatch by `collection` through
//! the matching `observing_db::processing::*_from_json` parser, hand the
//! result to the per-table `upsert` helper, and DELETE the ledger row on
//! success. Failures are logged and left in the ledger for inspection. The
//! shared `observing_bootstrap::job` harness supplies the CLI flags, pool
//! setup, and drive loop.
//!
//! Intentionally bypasses the tap-ingester wrappers: skips media resolution
//! and notification creation. Those are live-firehose concerns, not replay
//! concerns.

use chrono::{DateTime, Utc};
use observing_bootstrap::job::{self, JobOpts, Outcome};
use observing_db::{comments, identifications, interactions, likes, occurrences, processing};
use serde_json::Value;
use sqlx::postgres::PgPool;
use std::process::ExitCode;
use tracing::{error, info, warn};

use observing_collections::{
    COMMENT_COLLECTION, IDENTIFICATION_COLLECTION, INTERACTION_COLLECTION, LIKE_COLLECTION,
    OCCURRENCE_COLLECTION,
};

#[derive(clap::Args, Debug)]
pub struct Args {
    #[command(flatten)]
    job: JobOpts,

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

pub async fn run(args: Args) -> ExitCode {
    let pool = match job::connect_pool(2).await {
        Ok(p) => p,
        Err(e) => {
            error!("{e}");
            return ExitCode::from(1);
        }
    };

    let rows = match fetch_rows(&pool, &args).await {
        Ok(r) => r,
        Err(e) => {
            error!(error = %e, "failed to read failed_records");
            return ExitCode::from(1);
        }
    };
    info!(candidates = rows.len(), "rows to consider");

    // Strictly sequential (concurrency 1): the query orders occurrences first
    // so children referencing them via subject_uri don't FK-violate, and
    // multiple updates to one URI must replay in order. buffer_unordered(1)
    // preserves that submission order.
    let summary = job::drive(rows, 1, |row| replay_one(&pool, row, args.job.dry_run)).await;

    // `identifications::upsert` no longer refreshes the `community_ids` matview
    // per row (it aggregates the whole table — O(n²) across a batch). Refresh
    // once after the batch drains so replayed identifications are reflected.
    if !args.job.dry_run && summary.done.values().sum::<u64>() > 0 {
        if let Err(e) = identifications::refresh_community_ids(&pool).await {
            warn!(error = %e, "failed to refresh community_ids after replay");
        }
    }

    info!(
        scanned = summary.scanned(),
        done = ?summary.done,
        skipped = summary.skipped,
        failed = summary.failed,
        "done"
    );
    ExitCode::SUCCESS
}

async fn fetch_rows(pool: &PgPool, args: &Args) -> Result<Vec<FailedRow>, sqlx::Error> {
    // Occurrences first so children referencing them via subject_uri don't
    // FK-violate within this same run. Within each group, oldest first so
    // multiple updates to the same URI replay in chronological order
    // (upserts are idempotent, but ordering keeps the final state honest).
    sqlx::query_as!(
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
        args.job.limit,
    )
    .fetch_all(pool)
    .await
}

async fn replay_one(pool: &PgPool, row: FailedRow, dry_run: bool) -> Outcome {
    // Deletes don't carry a record_json and don't need parsing — replaying
    // them is just re-issuing the DELETE, which is idempotent. Worth doing
    // if we ever ledger delete failures, but for now treat as skipped so
    // the operator can spot them.
    if row.action == "delete" {
        info!(uri = %row.uri, reason = "action=delete", "skipped");
        return Outcome::Skipped;
    }
    let Some(record_json) = row.record_json.as_ref() else {
        info!(uri = %row.uri, reason = "record_json is NULL", "skipped");
        return Outcome::Skipped;
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
            info!(uri = %row.uri, reason = %format!("unsupported collection: {other}"), "skipped");
            return Outcome::Skipped;
        }
    };

    match upsert_result {
        Ok(()) => {
            if dry_run {
                info!(uri = %row.uri, collection = %row.collection, "would replay");
                return Outcome::Done("replayed");
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
                    Outcome::Done("replayed")
                }
                Err(e) => {
                    warn!(uri = %row.uri, error = %e, "upsert succeeded but ledger delete failed");
                    Outcome::Failed
                }
            }
        }
        Err(e) => {
            warn!(uri = %row.uri, error = %e, "replay failed");
            Outcome::Failed
        }
    }
}
