//! Database layer for the Observ.ing ingester
//!
//! Delegates record parsing to the shared `observing-db` processing module
//! and uses `observing-db` for SQL execution.

use crate::error::Result;
use jetstream_client::CommitInfo;
use observing_db::processing;
use sqlx::postgres::{PgPool, PgPoolOptions};
use tracing::{debug, info, warn};

/// Look up the occurrence owner and create a notification (skips self-notifications)
async fn notify_occurrence_owner(
    pool: &PgPool,
    actor_did: &str,
    kind: &str,
    subject_uri: &str,
    reference_uri: &str,
) {
    let owner = sqlx::query_scalar!("SELECT did FROM occurrences WHERE uri = $1", subject_uri)
        .fetch_optional(pool)
        .await;
    match owner {
        Ok(Some(owner_did)) => {
            if let Err(e) = observing_db::notifications::create(
                pool,
                &owner_did,
                actor_did,
                kind,
                subject_uri,
                reference_uri,
            )
            .await
            {
                warn!(error = %e, "Failed to create notification");
            }
        }
        Ok(None) => {}
        Err(e) => {
            warn!(error = %e, "Failed to look up occurrence owner for notification");
        }
    }
}

/// Database connection and operations
pub struct Database {
    pool: PgPool,
}

impl Database {
    /// Connect to the database
    pub async fn connect(database_url: &str) -> Result<Self> {
        info!("Connecting to database...");
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect(database_url)
            .await?;
        info!("Database connection established");
        Ok(Self { pool })
    }

    /// Run database migrations using the shared migration
    pub async fn migrate(&self) -> Result<()> {
        observing_db::migrate::migrate(&self.pool).await?;
        Ok(())
    }

    /// Upsert an occurrence record
    pub async fn upsert_occurrence(&self, commit: &CommitInfo) -> Result<()> {
        debug!("Upserting occurrence: {}", commit.uri);

        let record_json = match &commit.record {
            Some(v) => v,
            None => {
                warn!(uri = %commit.uri, "Skipping occurrence without record");
                return Ok(());
            }
        };

        let params = match processing::occurrence_from_json(
            record_json,
            commit.uri.clone(),
            commit.cid.clone(),
            commit.did.clone(),
        ) {
            Ok(p) => p,
            Err(e) => {
                warn!(uri = %commit.uri, error = %e, "Failed to process occurrence record");
                return Ok(());
            }
        };

        observing_db::occurrences::upsert(&self.pool, &params).await?;

        // Sync occurrence_observers
        let co_observers = processing::extract_co_observers(record_json, &commit.did);
        observing_db::observers::sync(&self.pool, &commit.uri, &commit.did, &co_observers).await?;

        Ok(())
    }

    /// Delete an occurrence record
    pub async fn delete_occurrence(&self, uri: &str) -> Result<()> {
        debug!("Deleting occurrence: {}", uri);
        observing_db::occurrences::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Upsert an identification record
    pub async fn upsert_identification(&self, commit: &CommitInfo) -> Result<()> {
        debug!("Upserting identification: {}", commit.uri);

        let record_json = match &commit.record {
            Some(v) => v,
            None => {
                warn!(uri = %commit.uri, "Skipping identification without record");
                return Ok(());
            }
        };

        let params = match processing::identification_from_json(
            record_json,
            commit.uri.clone(),
            commit.cid.clone(),
            commit.did.clone(),
            commit.time,
        ) {
            Ok(p) => p,
            Err(e) => {
                warn!(uri = %commit.uri, error = %e, "Failed to process identification record");
                return Ok(());
            }
        };

        observing_db::identifications::upsert(&self.pool, &params).await?;
        notify_occurrence_owner(
            &self.pool,
            &commit.did,
            "identification",
            &params.subject_uri,
            &commit.uri,
        )
        .await;
        Ok(())
    }

    /// Delete an identification record
    pub async fn delete_identification(&self, uri: &str) -> Result<()> {
        debug!("Deleting identification: {}", uri);
        observing_db::identifications::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Upsert a comment record
    pub async fn upsert_comment(&self, commit: &CommitInfo) -> Result<()> {
        debug!("Upserting comment: {}", commit.uri);

        let record_json = match &commit.record {
            Some(v) => v,
            None => {
                warn!(uri = %commit.uri, "Skipping comment without record");
                return Ok(());
            }
        };

        let params = match processing::comment_from_json(
            record_json,
            commit.uri.clone(),
            commit.cid.clone(),
            commit.did.clone(),
            commit.time,
        ) {
            Ok(p) => p,
            Err(e) => {
                warn!(uri = %commit.uri, error = %e, "Failed to process comment record");
                return Ok(());
            }
        };

        observing_db::comments::upsert(&self.pool, &params).await?;
        notify_occurrence_owner(
            &self.pool,
            &commit.did,
            "comment",
            &params.subject_uri,
            &commit.uri,
        )
        .await;
        Ok(())
    }

    /// Delete a comment record
    pub async fn delete_comment(&self, uri: &str) -> Result<()> {
        debug!("Deleting comment: {}", uri);
        observing_db::comments::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Upsert an interaction record
    pub async fn upsert_interaction(&self, commit: &CommitInfo) -> Result<()> {
        debug!("Upserting interaction: {}", commit.uri);

        let record_json = match &commit.record {
            Some(v) => v,
            None => {
                warn!(uri = %commit.uri, "Skipping interaction without record");
                return Ok(());
            }
        };

        let params = match processing::interaction_from_json(
            record_json,
            commit.uri.clone(),
            commit.cid.clone(),
            commit.did.clone(),
            commit.time,
        ) {
            Ok(p) => p,
            Err(e) => {
                warn!(uri = %commit.uri, error = %e, "Failed to process interaction record");
                return Ok(());
            }
        };

        observing_db::interactions::upsert(&self.pool, &params).await?;
        Ok(())
    }

    /// Delete an interaction record
    pub async fn delete_interaction(&self, uri: &str) -> Result<()> {
        debug!("Deleting interaction: {}", uri);
        observing_db::interactions::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Upsert a like record
    pub async fn upsert_like(&self, commit: &CommitInfo) -> Result<()> {
        debug!("Upserting like: {}", commit.uri);

        let record_json = match &commit.record {
            Some(v) => v,
            None => {
                warn!(uri = %commit.uri, "Skipping like without record");
                return Ok(());
            }
        };

        let params = match processing::like_from_json(
            record_json,
            commit.uri.clone(),
            commit.cid.clone(),
            commit.did.clone(),
            commit.time,
        ) {
            Ok(p) => p,
            Err(e) => {
                warn!(uri = %commit.uri, error = %e, "Failed to process like record");
                return Ok(());
            }
        };

        observing_db::likes::create(&self.pool, &params).await?;
        notify_occurrence_owner(
            &self.pool,
            &commit.did,
            "like",
            &params.subject_uri,
            &commit.uri,
        )
        .await;
        Ok(())
    }

    /// Delete a like record
    pub async fn delete_like(&self, uri: &str) -> Result<()> {
        debug!("Deleting like: {}", uri);
        observing_db::likes::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Get the saved cursor for resumption
    pub async fn get_cursor(&self) -> Result<Option<i64>> {
        let row = sqlx::query!("SELECT value FROM ingester_state WHERE key = 'cursor'")
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.and_then(|r| r.value.parse::<i64>().ok()))
    }

    /// Save the cursor for resumption
    pub async fn save_cursor(&self, cursor: i64) -> Result<()> {
        let cursor_str = cursor.to_string();
        sqlx::query!(
            r#"
            INSERT INTO ingester_state (key, value, updated_at)
            VALUES ('cursor', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = NOW()
            "#,
            cursor_str
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Close the database connection
    #[allow(dead_code)]
    pub async fn close(&self) {
        info!("Closing database connection...");
        self.pool.close().await;
    }
}
