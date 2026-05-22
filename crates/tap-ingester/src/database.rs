//! Database write path.
//!
//! Delegates record parsing to the shared `observing-db` processing
//! module and uses `observing-db` for SQL execution. Methods take
//! scalar params (did, uri, cid, time, record JSON) rather than a
//! firehose-coupled `CommitInfo` struct.

use crate::error::{IngesterError, Result};
use crate::media_resolver::MediaResolver;
use chrono::{DateTime, Utc};
use observing_db::processing;
use serde_json::Value;
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

/// Run a `processing::*_from_json` call, returning `Err(Processing)` on parse failure.
///
/// The main loop's failure path catches this, checks the subject resolver,
/// and writes to `ingester.failed_records` if there's no cross-repo
/// dependency to resolve — so schema/format mismatches stay observable
/// instead of being silently warned-and-acked.
macro_rules! process_or_fail {
    ($uri:expr, $method:ident, $label:literal, $($arg:expr),* $(,)?) => {
        match processing::$method($($arg),*) {
            Ok(p) => p,
            Err(e) => {
                return Err(IngesterError::Processing(format!("{}: {}", $label, e)));
            }
        }
    };
}

pub struct Database {
    pool: PgPool,
    media_resolver: MediaResolver,
}

impl Database {
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

    /// Pool handle for read-only consumers (dashboard `/api/failed-records`).
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn upsert_occurrence(
        &self,
        did: &str,
        uri: &str,
        cid: &str,
        time: DateTime<Utc>,
        record: &Value,
    ) -> Result<()> {
        debug!("Upserting occurrence: {}", uri);

        let mut parsed = process_or_fail!(
            uri,
            occurrence_from_json,
            "occurrence",
            record,
            uri.to_string(),
            cid.to_string(),
            did.to_string(),
            time,
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

    pub async fn delete_occurrence(&self, uri: &str) -> Result<()> {
        debug!("Deleting occurrence: {}", uri);
        observing_db::occurrences::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Identifications are written with `accepted_taxon_key = NULL`. The
    /// `observing-resolve-taxa` background worker picks up unresolved rows
    /// on its next pass and stamps them — keeping ingest decoupled from
    /// GBIF availability and ingest latency independent of the upstream's.
    pub async fn upsert_identification(
        &self,
        did: &str,
        uri: &str,
        cid: &str,
        time: DateTime<Utc>,
        record: &Value,
    ) -> Result<()> {
        debug!("Upserting identification: {}", uri);

        let params = process_or_fail!(
            uri,
            identification_from_json,
            "identification",
            record,
            uri.to_string(),
            cid.to_string(),
            did.to_string(),
            time,
        );

        observing_db::identifications::upsert(&self.pool, &params).await?;
        notify_occurrence_owner(&self.pool, did, "identification", &params.subject_uri, uri).await;
        Ok(())
    }

    pub async fn delete_identification(&self, uri: &str) -> Result<()> {
        debug!("Deleting identification: {}", uri);
        observing_db::identifications::delete(&self.pool, uri).await?;
        Ok(())
    }

    pub async fn upsert_comment(
        &self,
        did: &str,
        uri: &str,
        cid: &str,
        time: DateTime<Utc>,
        record: &Value,
    ) -> Result<()> {
        debug!("Upserting comment: {}", uri);

        let params = process_or_fail!(
            uri,
            comment_from_json,
            "comment",
            record,
            uri.to_string(),
            cid.to_string(),
            did.to_string(),
            time,
        );

        observing_db::comments::upsert(&self.pool, &params).await?;
        notify_occurrence_owner(&self.pool, did, "comment", &params.subject_uri, uri).await;
        Ok(())
    }

    pub async fn delete_comment(&self, uri: &str) -> Result<()> {
        debug!("Deleting comment: {}", uri);
        observing_db::comments::delete(&self.pool, uri).await?;
        Ok(())
    }

    pub async fn upsert_interaction(
        &self,
        did: &str,
        uri: &str,
        cid: &str,
        time: DateTime<Utc>,
        record: &Value,
    ) -> Result<()> {
        debug!("Upserting interaction: {}", uri);

        let params = process_or_fail!(
            uri,
            interaction_from_json,
            "interaction",
            record,
            uri.to_string(),
            cid.to_string(),
            did.to_string(),
            time,
        );

        observing_db::interactions::upsert(&self.pool, &params).await?;
        Ok(())
    }

    pub async fn delete_interaction(&self, uri: &str) -> Result<()> {
        debug!("Deleting interaction: {}", uri);
        observing_db::interactions::delete(&self.pool, uri).await?;
        Ok(())
    }

    pub async fn upsert_like(
        &self,
        did: &str,
        uri: &str,
        cid: &str,
        time: DateTime<Utc>,
        record: &Value,
    ) -> Result<()> {
        debug!("Upserting like: {}", uri);

        let params = process_or_fail!(
            uri,
            like_from_json,
            "like",
            record,
            uri.to_string(),
            cid.to_string(),
            did.to_string(),
            time,
        );

        observing_db::likes::create(&self.pool, &params).await?;
        notify_occurrence_owner(&self.pool, did, "like", &params.subject_uri, uri).await;
        Ok(())
    }

    pub async fn delete_like(&self, uri: &str) -> Result<()> {
        debug!("Deleting like: {}", uri);
        observing_db::likes::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Append (or bump) a row in `ingester.failed_records` describing a
    /// record we've decided to drop after `process_record` returned
    /// `Err`. Idempotent: repeat failures for the same URI bump
    /// `attempts` and refresh `last_attempt_at`/`last_error`.
    pub async fn record_failure<'a>(
        &self,
        params: observing_db::failed_records::FailedRecord<'a>,
    ) -> Result<()> {
        observing_db::failed_records::record(&self.pool, params).await?;
        Ok(())
    }
}
