//! Database layer for the Observ.ing ingester
//!
//! Delegates record parsing to the shared `observing-db` processing module
//! and uses `observing-db` for SQL execution.

use crate::error::Result;
use crate::media_resolver::MediaResolver;
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

/// Extract the record JSON from a commit, or return `Ok(())` with a warning if missing.
macro_rules! require_record {
    ($commit:expr, $kind:expr) => {
        match &$commit.record {
            Some(v) => v,
            None => {
                warn!(uri = %$commit.uri, "Skipping {} without record", $kind);
                return Ok(());
            }
        }
    };
}

/// Process a record via a `processing::*_from_json` call, returning `Ok(())` with a warning on
/// parse failure.
macro_rules! process_or_warn {
    ($commit:expr, $method:ident, $label:literal, $($arg:expr),* $(,)?) => {
        match processing::$method($($arg),*) {
            Ok(p) => p,
            Err(e) => {
                warn!(uri = %$commit.uri, error = %e, "Failed to process {} record", $label);
                return Ok(());
            }
        }
    };
}

/// Database connection and operations
pub struct Database {
    pool: PgPool,
    media_resolver: MediaResolver,
}

impl Database {
    /// Connect to the database
    pub async fn connect(database_url: &str) -> Result<Self> {
        info!("Connecting to database...");
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .idle_timeout(Some(std::time::Duration::from_secs(300)))
            .connect(database_url)
            .await?;
        info!("Database connection established");
        Ok(Self {
            pool,
            media_resolver: MediaResolver::new(),
        })
    }

    /// Upsert an occurrence record
    pub async fn upsert_occurrence(&self, commit: &CommitInfo) -> Result<()> {
        debug!("Upserting occurrence: {}", commit.uri);

        let record_json = require_record!(commit, "occurrence");

        let mut parsed = process_or_warn!(
            commit,
            occurrence_from_json,
            "occurrence",
            record_json,
            commit.uri.clone(),
            commit.cid.clone(),
            commit.did.clone(),
            commit.time,
        );

        // Resolve associatedMedia strong refs → media records → blob entries.
        // The appview write path populates associated_media directly from
        // in-memory blobs, but firehose-only ingestion has only strong refs
        // and must fetch the referenced media records from the author's PDS.
        if !parsed.associated_media_refs.is_empty() {
            let entries = self
                .media_resolver
                .resolve(&parsed.associated_media_refs)
                .await;
            if !entries.is_empty() {
                match serde_json::to_value(&entries) {
                    Ok(v) => parsed.params.associated_media = Some(v),
                    Err(e) => warn!(error = %e, "Failed to serialize resolved associated_media"),
                }
            }
        }

        observing_db::occurrences::upsert(&self.pool, &parsed.params).await?;

        Ok(())
    }

    /// Delete an occurrence record
    pub async fn delete_occurrence(&self, uri: &str) -> Result<()> {
        debug!("Deleting occurrence: {}", uri);
        observing_db::occurrences::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Upsert an identification record.
    ///
    /// Identifications are written with `accepted_taxon_key = NULL`. The
    /// `resolve_taxa` background job picks up unresolved rows on its next
    /// pass and stamps them — keeping ingest decoupled from GBIF
    /// availability and ingest latency independent of the upstream's.
    pub async fn upsert_identification(&self, commit: &CommitInfo) -> Result<()> {
        debug!("Upserting identification: {}", commit.uri);

        let record_json = require_record!(commit, "identification");

        let params = process_or_warn!(
            commit,
            identification_from_json,
            "identification",
            record_json,
            commit.uri.clone(),
            commit.cid.clone(),
            commit.did.clone(),
            commit.time,
        );

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

        let record_json = require_record!(commit, "comment");

        let params = process_or_warn!(
            commit,
            comment_from_json,
            "comment",
            record_json,
            commit.uri.clone(),
            commit.cid.clone(),
            commit.did.clone(),
            commit.time,
        );

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

        let record_json = require_record!(commit, "interaction");

        let params = process_or_warn!(
            commit,
            interaction_from_json,
            "interaction",
            record_json,
            commit.uri.clone(),
            commit.cid.clone(),
            commit.did.clone(),
            commit.time,
        );

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

        let record_json = require_record!(commit, "like");

        let params = process_or_warn!(
            commit,
            like_from_json,
            "like",
            record_json,
            commit.uri.clone(),
            commit.cid.clone(),
            commit.did.clone(),
            commit.time,
        );

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
}
