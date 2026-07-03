//! Postgres pool construction, sized per workload.
//!
//! Every binary that talks to the database was hand-rolling the same
//! `PgPoolOptions::new().max_connections(..).acquire_timeout(..)...connect(url)`
//! chain, differing only in the numbers. The numbers *should* differ — a
//! 50-connection public API pool and a single-connection migration runner want
//! very different sizing — so this module keeps the shape in one place and
//! exposes the per-workload sizing as named [`PoolConfig`] presets.
//!
//! URL resolution stays separate: [`PoolConfig::connect`] takes an
//! already-resolved connection string (for callers that read `DATABASE_URL`
//! themselves, e.g. an admin migration role), and [`PoolConfig::connect_from_env`]
//! layers `pg_url_env` resolution on top for the common Cloud Run / Cloud SQL
//! case.

use std::time::Duration;

use sqlx::postgres::{PgPool, PgPoolOptions};

/// Connection-pool sizing for one workload.
///
/// Construct with a preset ([`service`](Self::service), [`ingester`](Self::ingester),
/// [`migration`](Self::migration), [`worker`](Self::worker), [`job`](Self::job)),
/// then override individual fields with the builder setters if a specific
/// deployment needs to. All presets use the same defaults for the pieces they
/// don't care about (no idle recycling, no max lifetime).
#[derive(Debug, Clone)]
pub struct PoolConfig {
    /// Upper bound on open connections.
    pub max_connections: u32,
    /// How long `acquire()` waits for a free connection before erroring.
    pub acquire_timeout: Duration,
    /// Close a connection after it sits idle this long. `None` keeps idle
    /// connections open for the pool's lifetime.
    pub idle_timeout: Option<Duration>,
    /// Retire and reopen a connection after it has lived this long, regardless
    /// of activity. `None` never retires on age.
    pub max_lifetime: Option<Duration>,
}

impl PoolConfig {
    /// Long-lived public API service. Wide pool (50), short acquire timeout so
    /// a saturated pool fails fast, and both idle recycling and a max lifetime
    /// so connections churn behind a connection-pooling proxy / Cloud SQL.
    pub fn service() -> Self {
        Self {
            max_connections: 50,
            acquire_timeout: Duration::from_secs(5),
            idle_timeout: Some(Duration::from_secs(300)),
            max_lifetime: Some(Duration::from_secs(1800)),
        }
    }

    /// Firehose ingester. Moderate pool (10) for the concurrent write path,
    /// fast acquire timeout, idle recycling but no forced max lifetime.
    pub fn ingester() -> Self {
        Self {
            max_connections: 10,
            acquire_timeout: Duration::from_secs(5),
            idle_timeout: Some(Duration::from_secs(300)),
            max_lifetime: None,
        }
    }

    /// One-shot migration runner: a single admin connection, patient acquire
    /// timeout (cold Cloud SQL instances can be slow to accept the first
    /// connection).
    pub fn migration() -> Self {
        Self {
            max_connections: 1,
            acquire_timeout: Duration::from_secs(30),
            idle_timeout: None,
            max_lifetime: None,
        }
    }

    /// Long-running background worker doing periodic sweeps. A couple of
    /// connections, patient-ish acquire timeout.
    pub fn worker() -> Self {
        Self {
            max_connections: 2,
            acquire_timeout: Duration::from_secs(10),
            idle_timeout: None,
            max_lifetime: None,
        }
    }

    /// One-shot batch job sized for `concurrency` in-flight queries, plus one
    /// spare so the driving loop isn't starved by its own workers.
    pub fn job(concurrency: usize) -> Self {
        Self {
            max_connections: concurrency.max(1) as u32 + 1,
            acquire_timeout: Duration::from_secs(30),
            idle_timeout: None,
            max_lifetime: None,
        }
    }

    /// Override the connection cap.
    pub fn with_max_connections(mut self, max: u32) -> Self {
        self.max_connections = max;
        self
    }

    /// Override the acquire timeout.
    pub fn with_acquire_timeout(mut self, timeout: Duration) -> Self {
        self.acquire_timeout = timeout;
        self
    }

    /// Override the idle timeout (`None` disables idle recycling).
    pub fn with_idle_timeout(mut self, timeout: Option<Duration>) -> Self {
        self.idle_timeout = timeout;
        self
    }

    /// Override the max connection lifetime (`None` disables age-based retirement).
    pub fn with_max_lifetime(mut self, lifetime: Option<Duration>) -> Self {
        self.max_lifetime = lifetime;
        self
    }

    /// Connect a pool against an already-resolved connection string.
    ///
    /// Use this when the caller owns URL resolution — e.g. a migration runner
    /// that insists on a full admin `DATABASE_URL` rather than assembled
    /// `DB_*` parts. For the common case, prefer [`connect_from_env`](Self::connect_from_env).
    pub async fn connect(&self, url: &str) -> Result<PgPool, sqlx::Error> {
        let mut opts = PgPoolOptions::new()
            .max_connections(self.max_connections)
            .acquire_timeout(self.acquire_timeout);
        if let Some(idle) = self.idle_timeout {
            opts = opts.idle_timeout(Some(idle));
        }
        if let Some(lifetime) = self.max_lifetime {
            opts = opts.max_lifetime(Some(lifetime));
        }
        opts.connect(url).await
    }

    /// Resolve the connection string from the environment, then connect.
    ///
    /// The URL is resolved the way the services resolve theirs: `DATABASE_URL`
    /// if set (local dev), otherwise assembled from the
    /// `DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` parts (Cloud Run + Cloud SQL,
    /// where a role-scoped password comes from a secret). `default_db_name` is
    /// the database name to fall back to when only `DB_HOST` is provided.
    ///
    /// Returns a human-readable error string suitable for logging immediately
    /// before a non-zero exit.
    pub async fn connect_from_env(&self, default_db_name: &str) -> Result<PgPool, String> {
        let url = pg_url_env::database_url_from_env(default_db_name).ok_or_else(|| {
            "set DATABASE_URL, or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD".to_string()
        })?;
        self.connect(&url)
            .await
            .map_err(|e| format!("failed to connect: {e}"))
    }
}
