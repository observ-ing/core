use crate::types::{IdentificationRow, UpsertIdentificationParams};
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;
use tracing::{error, trace};

/// Upsert an identification record.
///
/// Does NOT refresh the `community_ids` matview — the matview aggregates the
/// whole identifications⋈occurrences tables, so refreshing per record is
/// O(table) work per call. Callers signal a debounced
/// [`CommunityIdsRefresher`] instead (or, for batch jobs, call
/// [`refresh_community_ids`] once when the batch drains).
///
/// Uses the dynamic query API rather than the `query!` macro so the new
/// `accepted_taxon_key` column doesn't require regenerating the offline
/// sqlx-prepare cache.
pub async fn upsert(pool: &PgPool, p: &UpsertIdentificationParams) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO identifications (
            uri, cid, did, subject_uri, subject_cid, scientific_name,
            taxon_rank, taxon_id, date_identified, kingdom, accepted_taxon_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (uri) DO UPDATE SET
            cid = $2,
            scientific_name = $6,
            taxon_rank = COALESCE($7, identifications.taxon_rank),
            taxon_id = COALESCE($8, identifications.taxon_id),
            kingdom = COALESCE($10, identifications.kingdom),
            accepted_taxon_key = COALESCE($11, identifications.accepted_taxon_key),
            indexed_at = NOW()
        "#,
    )
    .bind(&p.uri)
    .bind(&p.cid)
    .bind(&p.did)
    .bind(&p.subject_uri)
    .bind(&p.subject_cid)
    .bind(&p.scientific_name)
    .bind(&p.taxon_rank)
    .bind(&p.taxon_id)
    .bind(p.date_identified)
    .bind(&p.kingdom)
    .bind(p.accepted_taxon_key)
    .execute(pool)
    .await?;

    Ok(())
}

/// Delete an identification.
///
/// Like [`upsert`], does NOT refresh the `community_ids` matview; callers
/// drive that via a debounced [`CommunityIdsRefresher`] or a batch-end
/// [`refresh_community_ids`].
pub async fn delete(pool: &PgPool, uri: &str) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM identifications WHERE uri = $1", uri)
        .execute(pool)
        .await?;
    Ok(())
}

/// Get all identifications for an occurrence
pub async fn get_for_occurrence(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
) -> Result<Vec<IdentificationRow>, sqlx::Error> {
    sqlx::query_as!(
        IdentificationRow,
        r#"
        SELECT
            uri, cid, did, subject_uri, subject_cid, scientific_name,
            taxon_rank, identification_qualifier, taxon_id,
            identification_verification_status, type_status, date_identified,
            kingdom, phylum, class, "order" as order_, family, genus
        FROM identifications
        WHERE subject_uri = $1
        ORDER BY date_identified DESC
        "#,
        occurrence_uri,
    )
    .fetch_all(executor)
    .await
}

/// Get identifications for multiple occurrences (batch)
pub async fn get_for_subjects_batch(
    executor: impl sqlx::PgExecutor<'_>,
    uris: &[String],
) -> Result<HashMap<String, Vec<IdentificationRow>>, sqlx::Error> {
    if uris.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query_as!(
        IdentificationRow,
        r#"
        SELECT
            uri, cid, did, subject_uri, subject_cid, scientific_name,
            taxon_rank, identification_qualifier, taxon_id,
            identification_verification_status, type_status, date_identified,
            kingdom, phylum, class, "order" as order_, family, genus
        FROM identifications
        WHERE subject_uri = ANY($1)
        ORDER BY subject_uri, date_identified DESC
        "#,
        uris,
    )
    .fetch_all(executor)
    .await?;

    let mut map: HashMap<String, Vec<IdentificationRow>> = HashMap::new();
    for row in rows {
        let key = row.subject_uri.clone();
        map.entry(key).or_default().push(row);
    }
    Ok(map)
}

/// Get the community ID (winning taxon) for an occurrence
pub async fn get_community_id(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT scientific_name
        FROM community_ids
        WHERE occurrence_uri = $1
        ORDER BY id_count DESC
        LIMIT 1
        "#,
        occurrence_uri,
    )
    .fetch_optional(executor)
    .await?;
    Ok(row.and_then(|r| r.scientific_name))
}

/// Get community IDs (winning taxon) for multiple occurrences (batch)
pub async fn get_community_ids_for_occurrences(
    executor: impl sqlx::PgExecutor<'_>,
    uris: &[String],
) -> Result<HashMap<String, String>, sqlx::Error> {
    if uris.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT DISTINCT ON (occurrence_uri)
            occurrence_uri as "occurrence_uri!", scientific_name
        FROM community_ids
        WHERE occurrence_uri = ANY($1)
        ORDER BY occurrence_uri, id_count DESC
        "#,
        uris,
    )
    .fetch_all(executor)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|r| Some((r.occurrence_uri, r.scientific_name?)))
        .collect())
}

/// Refresh the community IDs materialized view.
///
/// `REFRESH MATERIALIZED VIEW CONCURRENTLY` cannot run inside a transaction,
/// so the executor must be a real connection/pool, not a transaction handle.
/// On the firehose hot path prefer [`CommunityIdsRefresher`], which coalesces
/// these calls; use this directly only for one-shot/batch refreshes.
pub async fn refresh_community_ids(executor: impl sqlx::PgExecutor<'_>) -> Result<(), sqlx::Error> {
    sqlx::query!("REFRESH MATERIALIZED VIEW CONCURRENTLY community_ids")
        .execute(executor)
        .await?;
    Ok(())
}

/// Coalesces `REFRESH MATERIALIZED VIEW CONCURRENTLY community_ids`.
///
/// The `community_ids` matview aggregates the *entire* identifications⋈occurrences
/// tables, so refreshing it once per ingested identification (the old behavior
/// of [`upsert`]/[`delete`]) is O(table) work per firehose event and serializes
/// ingest under any identification backlog or replay. Instead, the ingest path
/// calls the cheap, non-blocking [`request_refresh`](Self::request_refresh); a
/// single background task runs at most one refresh per `debounce` window and
/// always performs a trailing refresh after the last request, so the view
/// converges.
///
/// The trade-off is up to `debounce` of staleness in the consensus view, which
/// is acceptable for an eventually-consistent aggregate. Every committed
/// identification is still eventually reflected: callers invoke
/// `request_refresh` *after* their write commits, so the row is visible to the
/// snapshot of any refresh that observes the request.
#[derive(Clone)]
pub struct CommunityIdsRefresher {
    dirty: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl CommunityIdsRefresher {
    /// Spawn the background refresh task. Must be called within a Tokio runtime.
    pub fn spawn(pool: PgPool, debounce: Duration) -> Self {
        let dirty = Arc::new(AtomicBool::new(false));
        let notify = Arc::new(Notify::new());
        let this = Self {
            dirty: Arc::clone(&dirty),
            notify: Arc::clone(&notify),
        };

        tokio::spawn(async move {
            loop {
                // Park until something marks the view dirty. `notify_one`
                // stores a permit when no task is waiting, so a request that
                // races this check is not lost.
                while !dirty.swap(false, Ordering::SeqCst) {
                    notify.notified().await;
                }

                // Absorb a burst of further requests into this one refresh.
                tokio::time::sleep(debounce).await;

                // Requests that landed during the window have already committed
                // (callers signal post-commit), so the upcoming refresh covers
                // them — clear the flag to avoid a redundant trailing pass. A
                // request that races the refresh re-sets the flag and gets its
                // own pass: correctness over a possible extra refresh.
                dirty.store(false, Ordering::SeqCst);

                if let Err(e) = refresh_community_ids(&pool).await {
                    error!(error = %e, "failed to refresh community_ids matview");
                } else {
                    trace!("refreshed community_ids matview");
                }
            }
        });

        this
    }

    /// Mark the matview stale. Cheap and non-blocking — safe on the firehose
    /// hot path. Call it *after* the identification write commits.
    pub fn request_refresh(&self) {
        self.dirty.store(true, Ordering::SeqCst);
        self.notify.notify_one();
    }
}
