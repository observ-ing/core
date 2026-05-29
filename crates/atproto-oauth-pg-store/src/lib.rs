//! PostgreSQL-backed `StateStore` and `SessionStore` for [`atrium-oauth`].
//!
//! [`atrium-oauth`] ships only in-memory stores, so any AT Protocol app that
//! wants OAuth sessions to survive a restart (or be shared across replicas)
//! has to implement these traits against a database. This crate provides that
//! implementation for PostgreSQL via [`sqlx`].
//!
//! Two tables are required — `oauth_state` (short-lived PKCE/CSRF flow data,
//! expired by a TTL) and `oauth_sessions` (logged-in user sessions, keyed by
//! DID). The DDL ships in this crate's `migrations/` directory; point
//! `sqlx migrate` at it or copy it into your own migrations.
//!
//! ```ignore
//! use atproto_oauth_pg_store::{PgSessionStore, PgStateStore};
//!
//! let state_store = PgStateStore::new(pool.clone());
//! let session_store = PgSessionStore::new(pool);
//! let client = atrium_oauth::OAuthClient::new(atrium_oauth::OAuthClientConfig {
//!     // ...
//!     state_store,
//!     session_store,
//! })?;
//! ```
//!
//! [`atrium-oauth`]: https://docs.rs/atrium-oauth

use atrium_common::store::Store;
use atrium_oauth::store::session::SessionStore;
use atrium_oauth::store::state::StateStore;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sqlx::PgPool;
use std::fmt::{self, Debug, Display};
use std::hash::Hash;

/// Default TTL applied to OAuth `state` entries (PKCE/CSRF), in milliseconds.
///
/// Ten minutes is comfortably longer than a user takes to complete an
/// authorization redirect, while keeping the `oauth_state` table from
/// accumulating abandoned flows.
pub const DEFAULT_STATE_TTL_MS: i64 = 600_000;

/// Error returned by the store operations: either the database failed or a
/// stored value could not be (de)serialized.
#[derive(Debug)]
pub enum PgStoreError {
    Database(sqlx::Error),
    Serialization(serde_json::Error),
}

impl Display for PgStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Database(e) => write!(f, "Database error: {e}"),
            Self::Serialization(e) => write!(f, "Serialization error: {e}"),
        }
    }
}

impl std::error::Error for PgStoreError {}

impl From<sqlx::Error> for PgStoreError {
    fn from(e: sqlx::Error) -> Self {
        Self::Database(e)
    }
}

impl From<serde_json::Error> for PgStoreError {
    fn from(e: serde_json::Error) -> Self {
        Self::Serialization(e)
    }
}

// ---------------------------------------------------------------------------
// Raw SQL helpers
//
// Runtime queries (not the `query!` macro) so the crate compiles without a
// live database or a vendored `.sqlx` cache — consumers only need the two
// tables to exist at runtime.
// ---------------------------------------------------------------------------

/// Get an OAuth `state` value, but only if it has not yet expired.
pub async fn get_state(
    executor: impl sqlx::PgExecutor<'_>,
    key: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT value FROM oauth_state WHERE key = $1 AND expires_at > NOW()",
    )
    .bind(key)
    .fetch_optional(executor)
    .await
}

/// Upsert an OAuth `state` value with a TTL (in milliseconds).
pub async fn set_state(
    executor: impl sqlx::PgExecutor<'_>,
    key: &str,
    value: &str,
    ttl_ms: i64,
) -> Result<(), sqlx::Error> {
    let ttl_str = ttl_ms.to_string();
    sqlx::query(
        "INSERT INTO oauth_state (key, value, expires_at) \
         VALUES ($1, $2, NOW() + ($3 || ' milliseconds')::interval) \
         ON CONFLICT (key) DO UPDATE \
         SET value = $2, expires_at = NOW() + ($3 || ' milliseconds')::interval",
    )
    .bind(key)
    .bind(value)
    .bind(ttl_str)
    .execute(executor)
    .await?;
    Ok(())
}

/// Delete a single OAuth `state` entry.
pub async fn delete_state(
    executor: impl sqlx::PgExecutor<'_>,
    key: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM oauth_state WHERE key = $1")
        .bind(key)
        .execute(executor)
        .await?;
    Ok(())
}

/// Delete all expired OAuth `state` entries.
pub async fn cleanup_expired_state(executor: impl sqlx::PgExecutor<'_>) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM oauth_state WHERE expires_at < NOW()")
        .execute(executor)
        .await?;
    Ok(())
}

/// Get an OAuth `session` value (the serialized atrium session JSON).
pub async fn get_session(
    executor: impl sqlx::PgExecutor<'_>,
    key: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>("SELECT value FROM oauth_sessions WHERE key = $1")
        .bind(key)
        .fetch_optional(executor)
        .await
}

/// Upsert an OAuth `session` value.
pub async fn set_session(
    executor: impl sqlx::PgExecutor<'_>,
    key: &str,
    value: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO oauth_sessions (key, value) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET value = $2",
    )
    .bind(key)
    .bind(value)
    .execute(executor)
    .await?;
    Ok(())
}

/// Delete a single OAuth `session`.
pub async fn delete_session(
    executor: impl sqlx::PgExecutor<'_>,
    key: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM oauth_sessions WHERE key = $1")
        .bind(key)
        .execute(executor)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// atrium-oauth StateStore
// ---------------------------------------------------------------------------

/// PostgreSQL-backed state store for OAuth PKCE/CSRF flow data.
///
/// Entries are written with a TTL (see [`DEFAULT_STATE_TTL_MS`]); reads filter
/// out expired rows, and [`Store::clear`] purges everything already expired.
pub struct PgStateStore {
    pool: PgPool,
    state_ttl_ms: i64,
}

impl PgStateStore {
    /// Create a store using the [`DEFAULT_STATE_TTL_MS`] TTL.
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            state_ttl_ms: DEFAULT_STATE_TTL_MS,
        }
    }

    /// Create a store with a custom `state` TTL in milliseconds.
    pub fn with_ttl_ms(pool: PgPool, state_ttl_ms: i64) -> Self {
        Self { pool, state_ttl_ms }
    }
}

impl StateStore for PgStateStore {}

impl<K, V> Store<K, V> for PgStateStore
where
    K: Debug + Eq + Hash + Send + Sync + 'static + AsRef<str>,
    V: Debug + Clone + Send + Sync + 'static + Serialize + DeserializeOwned,
{
    type Error = PgStoreError;

    async fn get(&self, key: &K) -> Result<Option<V>, Self::Error> {
        let value = get_state(&self.pool, key.as_ref()).await?;
        match value {
            Some(json_str) => Ok(Some(serde_json::from_str(&json_str)?)),
            None => Ok(None),
        }
    }

    async fn set(&self, key: K, value: V) -> Result<(), Self::Error> {
        let json_str = serde_json::to_string(&value)?;
        set_state(&self.pool, key.as_ref(), &json_str, self.state_ttl_ms).await?;
        Ok(())
    }

    async fn del(&self, key: &K) -> Result<(), Self::Error> {
        delete_state(&self.pool, key.as_ref()).await?;
        Ok(())
    }

    async fn clear(&self) -> Result<(), Self::Error> {
        cleanup_expired_state(&self.pool).await?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// atrium-oauth SessionStore
// ---------------------------------------------------------------------------

/// PostgreSQL-backed session store for OAuth sessions, keyed by DID.
pub struct PgSessionStore {
    pool: PgPool,
}

impl PgSessionStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl SessionStore for PgSessionStore {}

impl<K, V> Store<K, V> for PgSessionStore
where
    K: Debug + Eq + Hash + Send + Sync + 'static + AsRef<str>,
    V: Debug + Clone + Send + Sync + 'static + Serialize + DeserializeOwned,
{
    type Error = PgStoreError;

    async fn get(&self, key: &K) -> Result<Option<V>, Self::Error> {
        let value = get_session(&self.pool, key.as_ref()).await?;
        match value {
            Some(json_str) => Ok(Some(serde_json::from_str(&json_str)?)),
            None => Ok(None),
        }
    }

    async fn set(&self, key: K, value: V) -> Result<(), Self::Error> {
        let json_str = serde_json::to_string(&value)?;
        set_session(&self.pool, key.as_ref(), &json_str).await?;
        Ok(())
    }

    async fn del(&self, key: &K) -> Result<(), Self::Error> {
        delete_session(&self.pool, key.as_ref()).await?;
        Ok(())
    }

    async fn clear(&self) -> Result<(), Self::Error> {
        sqlx::query("DELETE FROM oauth_sessions")
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
