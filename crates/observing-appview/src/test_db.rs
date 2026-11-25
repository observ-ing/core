//! Scratch Postgres for appview tests that need the database, mirroring
//! `observing-db`'s `tests/db/common.rs`.
//!
//! Opt-in: set `TEST_DATABASE_URL` to a Postgres server with PostGIS (any
//! database on it). Each test creates, migrates, and drops its own database.
//! Without the variable, tests print a note and pass. CI runs them in the
//! `rust-db-test` job.

use std::str::FromStr;
use std::sync::atomic::{AtomicU32, Ordering};

use sqlx::postgres::{PgConnectOptions, PgConnection, PgPool};
use sqlx::{AssertSqlSafe, Connection};

/// Same advisory-lock key as `observing-db`'s harness, so migrations from
/// both test binaries are serialized against each other too.
const MIGRATE_LOCK_KEY: i64 = 0x6f62_7365_7276;

pub struct TestDb {
    pub pool: PgPool,
    server: PgPool,
    name: String,
}

pub async fn scratch() -> Option<TestDb> {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        eprintln!("skipping: set TEST_DATABASE_URL to run database tests");
        return None;
    };
    let server_opts = PgConnectOptions::from_str(&url).expect("parse TEST_DATABASE_URL");
    let server = PgPool::connect_with(server_opts.clone())
        .await
        .expect("connect to TEST_DATABASE_URL");
    let name = format!(
        "observing_appview_test_{}_{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    );
    sqlx::query(AssertSqlSafe(format!("CREATE DATABASE \"{name}\"")))
        .execute(&server)
        .await
        .expect("create scratch database");

    // See observing-db's harness: concurrent migrations race on CREATE ROLE.
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
