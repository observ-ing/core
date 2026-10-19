//! Run resolution passes by hand.
//!
//! Finds every distinct `(scientific_name, kingdom)` pair from
//! `identifications` whose `accepted_taxon_key` is still NULL, runs each
//! through the taxonomy resolver (populating the local `taxa` cache as a
//! side effect), and stamps every identification matching that pair with
//! the resolved key. Then does the same for rows carrying a `taxon_id` URI,
//! and refreshes the `community_ids` materialized view if anything changed
//! so downstream filters pick up the new keys. See [`pass`].
//!
//! Two modes:
//!
//! - **One-shot** (default): exits after a single pass. Use this for an
//!   on-demand backfill.
//! - **Loop** (with `--interval-secs N`): runs a pass, sleeps `N` seconds,
//!   repeats.
//!
//! In production, passes run on Cloud Tasks in `observing-worker`: tap-ingester
//! asks for one the minute after it writes an identification.
//!
//! Usage:
//!   cargo run -p observing-resolve-taxa
//!   cargo run -p observing-resolve-taxa -- --interval-secs 300
//!   cargo run -p observing-resolve-taxa -- --rate-limit-ms 200 --limit 1000

use std::process::ExitCode;
use std::time::Duration;

use clap::Parser;
use observing_bootstrap::db::PoolConfig;
use observing_taxonomy_gbif::GbifUpstream;
use tracing::{error, info};
use tracing_subscriber::{prelude::*, EnvFilter};
use wikidata_client::WikidataClient;

use observing_resolve_taxa::pass::{Clients, Cursor, Options, Outcome};

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
async fn main() -> ExitCode {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("observing_resolve_taxa=info,observing_db=info"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_stackdriver::layer())
        .init();

    let cli = Cli::parse();

    // DATABASE_URL, or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD on Cloud Run.
    let pool = match PoolConfig::worker().connect_from_env("observing").await {
        Ok(p) => p,
        Err(e) => {
            error!(error = %e, "Failed to connect to database");
            return ExitCode::from(1);
        }
    };
    let clients = Clients {
        pool,
        gbif: GbifUpstream::default(),
        wikidata: WikidataClient::new(),
    };
    let rate_limit = Duration::from_millis(cli.rate_limit_ms);

    let opts = Options {
        rate_limit,
        limit: cli.limit,
        dry_run: cli.dry_run,
        deadline: None,
    };
    loop {
        match clients.run_pass(Cursor::default(), &opts).await {
            Ok(report) => {
                debug_assert_eq!(report.outcome, Outcome::Complete);
                info!(updated_rows = report.updated_rows, "Pass complete");
            }
            Err(e) => {
                error!(error = %e, "Pass failed");
                return ExitCode::from(1);
            }
        }

        let Some(interval) = cli.interval_secs.filter(|_| !cli.dry_run) else {
            return ExitCode::SUCCESS;
        };
        info!(seconds = interval, "Sleeping until next pass");
        tokio::time::sleep(Duration::from_secs(interval)).await;
    }
}
