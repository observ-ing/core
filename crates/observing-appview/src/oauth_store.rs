use atrium_common::store::Store;
use atrium_oauth::store::session::SessionStore;
use atrium_oauth::store::state::StateStore;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sqlx::PgPool;
use std::fmt::{self, Debug, Display};
use std::hash::Hash;

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

/// PostgreSQL-backed state store for OAuth PKCE/CSRF flow data.
pub struct PgStateStore {
    pool: PgPool,
}

impl PgStateStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
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
        let value = observing_db::oauth::get_state(&self.pool, key.as_ref()).await?;
        match value {
            Some(json_str) => Ok(Some(serde_json::from_str(&json_str)?)),
            None => Ok(None),
        }
    }

    async fn set(&self, key: K, value: V) -> Result<(), Self::Error> {
        let json_str = serde_json::to_string(&value)?;
        // State entries expire after 10 minutes
        observing_db::oauth::set_state(&self.pool, key.as_ref(), &json_str, 600_000).await?;
        Ok(())
    }

    async fn del(&self, key: &K) -> Result<(), Self::Error> {
        observing_db::oauth::delete_state(&self.pool, key.as_ref()).await?;
        Ok(())
    }

    async fn clear(&self) -> Result<(), Self::Error> {
        observing_db::oauth::cleanup_expired_state(&self.pool).await?;
        Ok(())
    }
}

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
        let value = observing_db::oauth::get_session(&self.pool, key.as_ref()).await?;
        match value {
            Some(json_str) => Ok(Some(serde_json::from_str(&json_str)?)),
            None => Ok(None),
        }
    }

    async fn set(&self, key: K, value: V) -> Result<(), Self::Error> {
        let json_str = serde_json::to_string(&value)?;
        observing_db::oauth::set_session(&self.pool, key.as_ref(), &json_str).await?;
        Ok(())
    }

    async fn del(&self, key: &K) -> Result<(), Self::Error> {
        observing_db::oauth::delete_session(&self.pool, key.as_ref()).await?;
        Ok(())
    }

    async fn clear(&self) -> Result<(), Self::Error> {
        // Clear all sessions - use a custom query for this
        sqlx::query("DELETE FROM oauth_sessions")
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
