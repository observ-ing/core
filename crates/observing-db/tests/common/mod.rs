//! Scratch Postgres for the database regression tests in this directory.
//!
//! Opt-in: set `TEST_DATABASE_URL` to a Postgres server with PostGIS (any
//! database on it). Each test creates, migrates, and drops its own database,
//! so it never touches a dev database's data. Without the variable, tests
//! print a note and pass, so `cargo test` still works with no Postgres. CI
//! runs them in the `rust-db-test` job.

use std::str::FromStr;
use std::sync::atomic::{AtomicU32, Ordering};

use sqlx::postgres::{PgConnectOptions, PgConnection, PgPool};
use sqlx::{AssertSqlSafe, Connection};

/// Advisory-lock key serializing scratch-database migrations (arbitrary).
const MIGRATE_LOCK_KEY: i64 = 0x6f62_7365_7276;

pub struct TestDb {
    pub pool: PgPool,
    server: PgPool,
    name: String,
}

pub async fn scratch() -> Option<TestDb> {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        eprintln!("skipping: set TEST_DATABASE_URL to run database regression tests");
        return None;
    };
    let server_opts = PgConnectOptions::from_str(&url).expect("parse TEST_DATABASE_URL");
    let server = PgPool::connect_with(server_opts.clone())
        .await
        .expect("connect to TEST_DATABASE_URL");
    let name = format!(
        "observing_test_{}_{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    );
    sqlx::query(AssertSqlSafe(format!("CREATE DATABASE \"{name}\"")))
        .execute(&server)
        .await
        .expect("create scratch database");

    // Roles are cluster-global, and the runtime_base migration's IF EXISTS
    // guard is check-then-act, so scratch databases migrating concurrently
    // on a fresh server race on its CREATE ROLE. (The migration can't be
    // fixed in place: sqlx checksums applied migrations.) Serialize
    // migrations with an advisory lock in the TEST_DATABASE_URL database,
    // which every test process shares. It's held on an unpooled connection
    // so a panic mid-migrate closes the session and releases it.
    let mut lock = PgConnection::connect_with(&server_opts)
        .await
        .expect("connect");
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(MIGRATE_LOCK_KEY)
        .execute(&mut lock)
        .await
        .expect("take migration lock");

    let opts = server_opts.database(&name);
    // Migrate on a separate pool: the migrations set the database-level
    // search_path, which only applies to connections opened afterwards.
    let migrate_pool = PgPool::connect_with(opts.clone()).await.expect("connect");
    observing_db::migrate::migrate(&migrate_pool)
        .await
        .expect("migrate scratch database");
    migrate_pool.close().await;
    lock.close().await.expect("release migration lock");

    let pool = PgPool::connect_with(opts).await.expect("connect");
    Some(TestDb { pool, server, name })
}

impl TestDb {
    pub async fn drop(self) {
        self.pool.close().await;
        sqlx::query(AssertSqlSafe(format!(
            "DROP DATABASE \"{}\" WITH (FORCE)",
            self.name
        )))
        .execute(&self.server)
        .await
        .expect("drop scratch database");
    }
}
