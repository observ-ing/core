//! Scaffolding for one-shot batch jobs — data backfills, ledger replays, and
//! similar operator-driven sweeps that iterate rows and process each one.
//!
//! A job binary supplies the two things that actually differ between jobs — a
//! query that yields the work and an async closure that processes one item —
//! and this module handles the parts that don't: the shared CLI flags
//! ([`JobOpts`]), pool setup ([`connect_pool`]), and a bounded-concurrency
//! drive loop with a labeled tally ([`drive`] → [`Summary`]).
//!
//! The closure owns its own dry-run handling (capture [`JobOpts::dry_run`]) and
//! logs its own per-row detail; the harness only counts outcomes. See
//! `backfill-occurrences` and `replay-failed-records` for the two callers.

use std::collections::BTreeMap;
use std::future::Future;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use sqlx::postgres::{PgPool, PgPoolOptions};

/// CLI flags shared by every batch job. Flatten into a binary's own `Args`
/// with `#[command(flatten)]`, then add job-specific flags alongside.
///
/// Concurrency is deliberately *not* here: some jobs must run strictly
/// sequentially (e.g. parents before children), others want it tunable, so
/// each binary passes its own value to [`drive`].
#[derive(clap::Args, Debug, Clone)]
pub struct JobOpts {
    /// Do everything except write to the database.
    #[arg(long)]
    pub dry_run: bool,

    /// Cap on rows to process this run. Unbounded if omitted.
    #[arg(long)]
    pub limit: Option<i64>,
}

/// What happened to one row.
///
/// `Done` carries a `&'static str` bucket so a job can split its success count
/// into named tallies (e.g. `"filled"` vs `"unchanged"`) that show up in the
/// [`Summary`]. Jobs that don't care can pass a single constant label.
pub enum Outcome {
    Done(&'static str),
    Skipped,
    Failed,
}

/// Tally returned by [`drive`]. Log it as structured fields on completion.
#[derive(Default, Debug)]
pub struct Summary {
    /// Successful rows, bucketed by the label each returned.
    pub done: BTreeMap<&'static str, u64>,
    pub skipped: u64,
    pub failed: u64,
}

impl Summary {
    /// Total rows processed across all outcomes.
    pub fn scanned(&self) -> u64 {
        self.done.values().sum::<u64>() + self.skipped + self.failed
    }
}

/// Connect a pool sized for `concurrency` in-flight queries.
///
/// The connection string is resolved the same way the services resolve theirs:
/// `DATABASE_URL` if set (local dev), otherwise assembled from the
/// `DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` parts (Cloud Run + Cloud SQL,
/// where the role-scoped password comes from a secret). This lets a job run
/// under a least-privilege DB role in prod without anyone holding a full URL.
///
/// Returns a human-readable error string suitable for logging immediately
/// before a non-zero exit.
pub async fn connect_pool(concurrency: usize) -> Result<PgPool, String> {
    let url = pg_url_env::database_url_from_env("observing")
        .ok_or_else(|| "set DATABASE_URL, or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD".to_string())?;
    PgPoolOptions::new()
        .max_connections(concurrency.max(1) as u32 + 1)
        .acquire_timeout(Duration::from_secs(30))
        .connect(&url)
        .await
        .map_err(|e| format!("failed to connect: {e}"))
}

/// Run `process` over `rows` with up to `concurrency` items in flight,
/// collecting a [`Summary`].
///
/// Pass `concurrency = 1` for strict in-order, one-at-a-time processing (the
/// drive then completes items in the order `rows` yields them — important when
/// later rows depend on earlier ones).
pub async fn drive<Row, Proc, Fut>(rows: Vec<Row>, concurrency: usize, process: Proc) -> Summary
where
    Proc: Fn(Row) -> Fut,
    Fut: Future<Output = Outcome>,
{
    let outcomes = stream::iter(rows)
        .map(process)
        .buffer_unordered(concurrency.max(1))
        .collect::<Vec<_>>()
        .await;

    let mut summary = Summary::default();
    for outcome in outcomes {
        match outcome {
            Outcome::Done(label) => *summary.done.entry(label).or_default() += 1,
            Outcome::Skipped => summary.skipped += 1,
            Outcome::Failed => summary.failed += 1,
        }
    }
    summary
}
