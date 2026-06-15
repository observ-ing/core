//! `observing-task-runner` — one binary that dispatches observ.ing's one-off
//! operational tasks by subcommand (data backfills, ledger replays, …).
//!
//! These are operator-triggered, run-to-completion-and-exit tasks — *not*
//! background workers pulling off a queue. Bundling them behind one binary
//! means a new task is a module + a `Task` arm, rather than a fresh crate,
//! Dockerfile stage, CI matrix entry, and Cloud Run Job each time. Each task's
//! per-row logic lives in its module; the shared `observing_bootstrap::job`
//! harness provides the CLI flags, pool setup, and bounded-concurrency loop.
//!
//! ```text
//! observing-task-runner backfill-occurrences --dry-run --all
//! observing-task-runner backfill-event-date-bounds --dry-run
//! observing-task-runner replay-failed-records --collection bio.lexicons.temp.v0-1.occurrence
//! ```
//!
//! Heavyweight or odd-dependency tasks (e.g. anything pulling the ONNX runtime)
//! should stay their own binary rather than bloat this one.

use clap::{Parser, Subcommand};
use std::process::ExitCode;
use tracing_subscriber::{prelude::*, EnvFilter};

mod backfill_event_date_bounds;
mod backfill_occurrences;
mod replay_failed_records;

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    task: Task,
}

#[derive(Subcommand, Debug)]
enum Task {
    /// Re-fetch occurrences from their authoring PDS and re-run the upsert, to
    /// backfill newly-extracted columns (organismQuantity/organismQuantityType).
    BackfillOccurrences(backfill_occurrences::Args),
    /// Recompute event_date_start/end from event_date_raw, recovering bounds
    /// for EDTF values the old parser couldn't handle. No PDS round-trip.
    BackfillEventDateBounds(backfill_event_date_bounds::Args),
    /// Replay rows from `ingester.failed_records` back through the upsert path.
    ReplayFailedRecords(replay_failed_records::Args),
}

#[tokio::main]
async fn main() -> ExitCode {
    // One subscriber for every task; the default filter covers all task
    // modules (`observing_task_runner::*`). Override with `RUST_LOG`.
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("observing_task_runner=info"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .init();

    match Cli::parse().task {
        Task::BackfillOccurrences(args) => backfill_occurrences::run(args).await,
        Task::BackfillEventDateBounds(args) => backfill_event_date_bounds::run(args).await,
        Task::ReplayFailedRecords(args) => replay_failed_records::run(args).await,
    }
}
