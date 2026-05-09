//! Background resolver-cache worker.
//!
//! Walks every distinct `(scientific_name, kingdom)` pair from
//! `identifications` whose `accepted_taxon_key` is still NULL, runs each
//! through the taxonomy resolver (populating the local `taxa` cache as a
//! side effect), and stamps every identification matching that pair with
//! the resolved key. Refreshes the `community_ids` materialized view at
//! the end of each pass so downstream filters pick up the new keys.
//!
//! Two modes:
//!
//! - **One-shot** (default): exits after a single pass. Use this from
//!   Cloud Run Jobs / Cloud Scheduler for periodic runs, or for an
//!   on-demand backfill.
//! - **Loop** (with `--interval-secs N`): runs a pass, sleeps `N`
//!   seconds, repeats. Use this from a long-lived sidecar / for local
//!   development.
//!
//! Identification ingest writes `accepted_taxon_key = NULL`; this worker
//! is the only path that fills it in. Higher-rank filters (taxon-page,
//! explore by kingdom) lag new ingests by up to one pass interval.
//!
//! Usage:
//!   cargo run --bin resolve_taxa
//!   cargo run --bin resolve_taxa -- --interval-secs 300
//!   cargo run --bin resolve_taxa -- --rate-limit-ms 200 --limit 1000

use std::time::Duration;

use clap::Parser;
use observing_db::taxonomy_resolver::Resolver;
use observing_taxonomy_gbif::GbifUpstream;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Row};
use tracing::{error, info, warn};
use tracing_subscriber::{prelude::*, EnvFilter};

#[derive(Parser, Clone)]
#[command(about = "Resolve and cache taxonomy for already-ingested identifications")]
struct Cli {
    /// Optional pause between GBIF lookups (defaults to 100ms to be polite).
    #[arg(long, default_value_t = 100)]
    rate_limit_ms: u64,

    /// Cap on the number of distinct (name, kingdom) pairs processed in
    /// one pass. Useful for incremental progress against a large backlog.
    #[arg(long)]
    limit: Option<i64>,

    /// Print what would be resolved without calling GBIF or writing.
    #[arg(long)]
    dry_run: bool,

    /// Run continuously: after each pass, sleep this many seconds and
    /// start another. Without this flag, exit after one pass.
    #[arg(long)]
    interval_secs: Option<u64>,
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("resolve_taxa=info,observing_db=info"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_stackdriver::layer())
        .init();

    let cli = Cli::parse();

    let database_url = match std::env::var("DATABASE_URL") {
        Ok(v) => v,
        Err(_) => {
            error!("DATABASE_URL is required");
            return std::process::ExitCode::from(2);
        }
    };

    let pool = match PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&database_url)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            error!(error = %e, "Failed to connect to database");
            return std::process::ExitCode::from(1);
        }
    };

    let upstream = GbifUpstream::default();
    let resolver = Resolver::new(&pool, &upstream);

    loop {
        match run_pass(&pool, &resolver, &cli).await {
            Ok(PassOutcome::DryRunDone) => return std::process::ExitCode::SUCCESS,
            Ok(PassOutcome::Done) => {}
            Err(code) => return code,
        }

        let Some(interval) = cli.interval_secs else {
            return std::process::ExitCode::SUCCESS;
        };
        info!(
            seconds = interval,
            "Pass complete; sleeping until next pass"
        );
        tokio::time::sleep(Duration::from_secs(interval)).await;
    }
}

enum PassOutcome {
    Done,
    DryRunDone,
}

/// Run one resolution pass: enumerate unresolved pairs, resolve each,
/// stamp matching identifications, refresh the matview.
async fn run_pass<U>(
    pool: &PgPool,
    resolver: &Resolver<'_, PgPool, U>,
    cli: &Cli,
) -> Result<PassOutcome, std::process::ExitCode>
where
    U: observing_db::taxonomy_resolver::TaxonomyUpstream,
{
    // Distinct (name, kingdom) pairs that still need a key. Pulled in one
    // shot — if the backlog ever grows beyond what fits in memory, switch
    // to keyset pagination over the same set.
    let mut q = String::from(
        r#"SELECT DISTINCT scientific_name, kingdom
           FROM identifications
           WHERE accepted_taxon_key IS NULL
             AND scientific_name <> ''
           ORDER BY scientific_name, kingdom"#,
    );
    if let Some(limit) = cli.limit {
        q.push_str(&format!(" LIMIT {limit}"));
    }
    let pairs: Vec<(String, Option<String>)> = match sqlx::query(&q).fetch_all(pool).await {
        Ok(rows) => rows
            .into_iter()
            .map(|r| {
                let name: String = r.get("scientific_name");
                let kingdom: Option<String> = r.try_get("kingdom").ok();
                (name, kingdom)
            })
            .collect(),
        Err(e) => {
            error!(error = %e, "Failed to enumerate identifications needing resolution");
            return Err(std::process::ExitCode::from(1));
        }
    };

    info!(
        pairs = pairs.len(),
        "Discovered (name, kingdom) pairs to resolve"
    );

    if pairs.is_empty() {
        return Ok(PassOutcome::Done);
    }

    if cli.dry_run {
        for (name, kingdom) in &pairs {
            info!(name = %name, kingdom = ?kingdom, "Would resolve");
        }
        return Ok(PassOutcome::DryRunDone);
    }

    let mut resolved = 0u64;
    let mut not_found = 0u64;
    let mut errors = 0u64;
    let mut updated_rows = 0u64;

    for (i, (name, kingdom)) in pairs.iter().enumerate() {
        let key = match resolver.resolve_by_name(name, kingdom.as_deref()).await {
            Ok(Some(row)) => {
                resolved += 1;
                row.accepted_taxon_key.unwrap_or(row.taxon_key)
            }
            Ok(None) => {
                not_found += 1;
                rate_limit(cli).await;
                continue;
            }
            Err(e) => {
                errors += 1;
                warn!(name = %name, kingdom = ?kingdom, error = %e, "Resolve failed");
                rate_limit(cli).await;
                continue;
            }
        };

        // Stamp every matching identification in one update. Uses the same
        // (name, optional-kingdom) shape as resolution so multi-row hits
        // share the cost.
        let update_sql = r#"UPDATE identifications
            SET accepted_taxon_key = $1, indexed_at = NOW()
            WHERE accepted_taxon_key IS NULL
              AND scientific_name = $2
              AND ($3::text IS NULL OR kingdom = $3)"#;
        match sqlx::query(update_sql)
            .bind(key)
            .bind(name)
            .bind(kingdom.as_deref())
            .execute(pool)
            .await
        {
            Ok(res) => updated_rows += res.rows_affected(),
            Err(e) => {
                errors += 1;
                warn!(name = %name, error = %e, "Failed to update identifications");
            }
        }

        if (i + 1) % 50 == 0 {
            info!(
                processed = i + 1,
                total = pairs.len(),
                resolved,
                not_found,
                updated_rows,
                "Progress",
            );
        }
        rate_limit(cli).await;
    }

    info!(
        resolved,
        not_found, errors, updated_rows, "Resolution pass complete; refreshing community_ids"
    );

    if let Err(e) = observing_db::identifications::refresh_community_ids(pool).await {
        error!(error = %e, "Failed to refresh community_ids matview");
        return Err(std::process::ExitCode::from(1));
    }

    Ok(PassOutcome::Done)
}

async fn rate_limit(cli: &Cli) {
    if cli.rate_limit_ms > 0 {
        tokio::time::sleep(Duration::from_millis(cli.rate_limit_ms)).await;
    }
}
