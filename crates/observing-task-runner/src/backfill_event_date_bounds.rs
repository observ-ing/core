//! `backfill-event-date-bounds` task: recompute `event_date_start`/
//! `event_date_end` from the stored `event_date_raw` string.
//!
//! Why this exists: the `[start, end)` bounds are derived from the verbatim
//! Darwin Core `eventDate` by `processing::expand_event_date`. Rows ingested
//! while that parser was the hand-rolled version got NULL bounds for any value
//! it couldn't handle — EDTF reduced precision / unspecified digits /
//! uncertainty (`196X`, `1984?`, `1931-XX`, …). The `edtf` crate (now backing
//! `expand_event_date`) parses those, so re-running it over the raw string
//! recovers the bounds. Unlike `backfill-occurrences`, this needs **no PDS
//! round-trip**: the source value is already in the DB, in `event_date_raw`.
//!
//! Safe to re-run: derivation is deterministic, so a second pass writes the
//! same bounds. By default only rows still missing `event_date_start` are
//! touched; `--all` re-derives every row that has a raw value. Rows whose raw
//! string isn't a recognized date even under full EDTF are left untouched (the
//! raw value still displays; it just has no sortable bounds).

use observing_bootstrap::job::{self, JobOpts, Outcome};
use observing_db::processing;
use sqlx::postgres::PgPool;
use std::process::ExitCode;
use tracing::{error, info, warn};

#[derive(clap::Args, Debug)]
pub struct Args {
    #[command(flatten)]
    job: JobOpts,

    /// Only process occurrences authored by this DID. Useful for verifying
    /// behavior on one repo before the full sweep.
    #[arg(long)]
    did: Option<String>,

    /// Re-derive bounds for every row that has an `event_date_raw`, not just
    /// rows still missing `event_date_start`. Idempotent; this just widens the
    /// candidate set.
    #[arg(long)]
    all: bool,

    /// Number of UPDATEs to run concurrently.
    #[arg(long, default_value_t = 8)]
    concurrency: usize,
}

struct Row {
    uri: String,
    event_date_raw: String,
}

pub async fn run(args: Args) -> ExitCode {
    let pool = match job::connect_pool(args.concurrency).await {
        Ok(p) => p,
        Err(e) => {
            error!("{e}");
            return ExitCode::from(1);
        }
    };

    let rows = match fetch_rows(&pool, &args).await {
        Ok(r) => r,
        Err(e) => {
            error!(error = %e, "failed to list occurrences");
            return ExitCode::from(1);
        }
    };
    info!(
        candidates = rows.len(),
        "occurrences to re-derive bounds for"
    );

    let summary = job::drive(rows, args.concurrency, |row| {
        backfill_one(&pool, row, args.job.dry_run)
    })
    .await;

    info!(
        scanned = summary.scanned(),
        done = ?summary.done,
        skipped = summary.skipped,
        failed = summary.failed,
        "done"
    );
    ExitCode::SUCCESS
}

async fn fetch_rows(pool: &PgPool, args: &Args) -> Result<Vec<Row>, sqlx::Error> {
    sqlx::query_as!(
        Row,
        r#"
        SELECT uri, event_date_raw as "event_date_raw!"
        FROM occurrences
        WHERE event_date_raw IS NOT NULL
          AND ($1::bool OR event_date_start IS NULL)
          AND ($2::text IS NULL OR did = $2)
        ORDER BY created_at ASC
        LIMIT COALESCE($3, 9223372036854775807)
        "#,
        args.all,
        args.did.as_deref(),
        args.job.limit,
    )
    .fetch_all(pool)
    .await
}

async fn backfill_one(pool: &PgPool, row: Row, dry_run: bool) -> Outcome {
    // The raw string is present but not a recognized date/interval even under
    // full EDTF — leave the bounds NULL. `failed` is reserved for write errors,
    // which point at a real bug rather than expected unparseable data.
    let bounds = match processing::expand_event_date(&row.event_date_raw) {
        Some(b) => b,
        None => {
            warn!(uri = %row.uri, raw = %row.event_date_raw, "skipped: unparseable eventDate");
            return Outcome::Skipped;
        }
    };

    if dry_run {
        info!(
            uri = %row.uri,
            raw = %row.event_date_raw,
            start = %bounds.start,
            end = %bounds.end,
            "would backfill bounds"
        );
        return Outcome::Done("filled");
    }

    // `event_date_range` is a generated column, so it updates automatically.
    match sqlx::query!(
        "UPDATE occurrences SET event_date_start = $2, event_date_end = $3 WHERE uri = $1",
        row.uri,
        bounds.start,
        bounds.end,
    )
    .execute(pool)
    .await
    {
        Ok(_) => {
            info!(uri = %row.uri, start = %bounds.start, end = %bounds.end, "backfilled bounds");
            Outcome::Done("filled")
        }
        Err(e) => {
            warn!(uri = %row.uri, error = %e, "failed: update");
            Outcome::Failed
        }
    }
}
