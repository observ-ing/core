//! One-shot CLI that re-fetches occurrence records from their authoring PDS
//! and re-runs them through the normal occurrence upsert.
//!
//! Why this exists: extracted columns are populated from the lexicon record at
//! ingest time. When a new field is added to the schema (e.g.
//! `organism_quantity` / `organism_quantity_type`, added in #600/#601) the
//! columns are NULL for every row that was ingested before the change — the
//! source value was never persisted in the DB, only on the author's PDS. A
//! SQL migration can't recover it; the only way to fill those columns is to
//! re-fetch each record and re-run the parser.
//!
//! Approach: iterate the `occurrences` table (we already hold every `uri` +
//! `did`), resolve each author's PDS, `getRecord` the live occurrence,
//! re-parse it via `processing::occurrence_from_json` (which now extracts the
//! quantity fields), and `occurrences::upsert` the result. The shared
//! `observing_bootstrap::job` harness supplies the CLI flags, pool setup, and
//! the bounded-concurrency drive loop; this binary supplies the query and the
//! per-row fetch/parse/upsert.
//!
//! Safe to re-run: the upsert COALESCEs the backfilled columns
//! (`organism_quantity = COALESCE($n, occurrences.organism_quantity)`), so a
//! second pass never clobbers a value with NULL, and `associated_media` is
//! likewise preserved. Records that have been deleted from their PDS, or whose
//! PDS is unreachable, are skipped rather than failing the run.

use atproto_blob_resolver::BlobResolver;
use chrono::{DateTime, Utc};
use clap::Parser;
use observing_bootstrap::job::{self, JobOpts, Outcome};
use observing_db::{occurrences, processing};
use sqlx::postgres::PgPool;
use std::process::ExitCode;
use std::time::Duration;
use tracing::{error, info, warn};
use tracing_subscriber::{prelude::*, EnvFilter};

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    #[command(flatten)]
    job: JobOpts,

    /// Only process occurrences authored by this DID. Useful for verifying
    /// behavior on one repo before the full sweep.
    #[arg(long)]
    did: Option<String>,

    /// Re-fetch every occurrence, not just rows still missing
    /// `organism_quantity`. The upsert is idempotent either way; this just
    /// widens the candidate set (and the number of PDS round trips).
    #[arg(long)]
    all: bool,

    /// Number of PDS fetches to run concurrently.
    #[arg(long, default_value_t = 8)]
    concurrency: usize,
}

struct OccurrenceRef {
    uri: String,
    did: String,
    cid: String,
    /// `created_at` is never touched by the ON CONFLICT branch of the upsert;
    /// it's passed only as the `fallback_time` the parser would use if this
    /// row had somehow been deleted between SELECT and upsert (INSERT branch).
    created_at: DateTime<Utc>,
}

#[tokio::main]
async fn main() -> ExitCode {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("backfill_occurrences=info"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .init();

    let args = Args::parse();

    let pool = match job::connect_pool(args.concurrency).await {
        Ok(p) => p,
        Err(e) => {
            error!("{e}");
            return ExitCode::from(1);
        }
    };

    // A bounded timeout keeps a single slow/hanging PDS from stalling the run.
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("reqwest client build should not fail with defaults");
    let resolver = BlobResolver::with_client(http);

    let rows = match fetch_rows(&pool, &args).await {
        Ok(r) => r,
        Err(e) => {
            error!(error = %e, "failed to list occurrences");
            return ExitCode::from(1);
        }
    };
    info!(candidates = rows.len(), "occurrences to re-fetch");

    let summary = job::drive(rows, args.concurrency, |row| {
        backfill_one(&pool, &resolver, row, args.job.dry_run)
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

async fn fetch_rows(pool: &PgPool, args: &Args) -> Result<Vec<OccurrenceRef>, sqlx::Error> {
    sqlx::query_as!(
        OccurrenceRef,
        r#"
        SELECT uri, did, cid, created_at as "created_at!: DateTime<Utc>"
        FROM occurrences
        WHERE ($1::bool OR organism_quantity IS NULL)
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

async fn backfill_one(
    pool: &PgPool,
    resolver: &BlobResolver,
    row: OccurrenceRef,
    dry_run: bool,
) -> Outcome {
    // A fetch failure here is expected for records that have since been
    // deleted, or whose PDS is temporarily unreachable. Treat it as a skip so
    // the sweep completes; `failed` stays reserved for parse/write errors,
    // which point at a real bug rather than transient/network state.
    let record = match resolver.fetch_record_by_aturi(&row.uri).await {
        Ok(v) => v,
        Err(e) => {
            warn!(uri = %row.uri, error = %e, "skipped: could not fetch record");
            return Outcome::Skipped;
        }
    };

    let parsed = match processing::occurrence_from_json(
        &record,
        row.uri.clone(),
        row.cid.clone(),
        row.did.clone(),
        row.created_at,
    ) {
        Ok(p) => p,
        Err(e) => {
            warn!(uri = %row.uri, error = %e, "failed: parse");
            return Outcome::Failed;
        }
    };

    let filled =
        parsed.params.organism_quantity.is_some() || parsed.params.organism_quantity_type.is_some();
    let label = if filled { "filled" } else { "unchanged" };

    if dry_run {
        info!(uri = %row.uri, filled, "would upsert");
        return Outcome::Done(label);
    }

    match occurrences::upsert(pool, &parsed.params).await {
        Ok(()) => {
            if filled {
                info!(
                    uri = %row.uri,
                    organism_quantity = ?parsed.params.organism_quantity,
                    organism_quantity_type = ?parsed.params.organism_quantity_type,
                    "backfilled quantity"
                );
            }
            Outcome::Done(label)
        }
        Err(e) => {
            warn!(uri = %row.uri, error = %e, "failed: upsert");
            Outcome::Failed
        }
    }
}
