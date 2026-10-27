//! Cross-posting occurrences to other platforms: the accounts users have
//! linked, and the queue of occurrences to post.
//!
//! A crosspost is `pending` until it is posted (`synced`) or has been tried
//! `max_attempts` times (`failed`). Every attempt is counted when it is
//! claimed, not when it ends, so a job whose worker died still backs off.
//! One queued with its occurrence may first wait for the ingester
//! ([`defer`]), which gives the attempt back.

use crate::types::{CrosspostLink, CrosspostRow, LinkedAccountRow};

pub async fn get_account(
    executor: impl sqlx::PgExecutor<'_>,
    did: &str,
    service: &str,
) -> Result<Option<LinkedAccountRow>, sqlx::Error> {
    sqlx::query_as!(
        LinkedAccountRow,
        r#"
        SELECT did, service, external_user_id, external_login, access_token, linked_at
        FROM linked_accounts
        WHERE did = $1 AND service = $2
        "#,
        did,
        service,
    )
    .fetch_optional(executor)
    .await
}

pub async fn upsert_account(
    executor: impl sqlx::PgExecutor<'_>,
    did: &str,
    service: &str,
    external_user_id: &str,
    external_login: &str,
    access_token: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO linked_accounts (did, service, external_user_id, external_login, access_token)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (did, service) DO UPDATE SET
            external_user_id = EXCLUDED.external_user_id,
            external_login = EXCLUDED.external_login,
            access_token = EXCLUDED.access_token,
            linked_at = NOW()
        "#,
        did,
        service,
        external_user_id,
        external_login,
        access_token,
    )
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn delete_account(
    executor: impl sqlx::PgExecutor<'_>,
    did: &str,
    service: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "DELETE FROM linked_accounts WHERE did = $1 AND service = $2",
        did,
        service,
    )
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn get(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    service: &str,
) -> Result<Option<CrosspostRow>, sqlx::Error> {
    sqlx::query_as!(
        CrosspostRow,
        r#"
        SELECT occurrence_uri, service, did, external_uri, synced_blob_cids,
               status, attempts, last_error, awaits_uris, waits
        FROM crossposts
        WHERE occurrence_uri = $1 AND service = $2
        "#,
        occurrence_uri,
        service,
    )
    .fetch_optional(executor)
    .await
}

/// The links cross-posting has produced for an occurrence, on any service.
pub async fn links_for_occurrence(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
) -> Result<Vec<CrosspostLink>, sqlx::Error> {
    sqlx::query_as!(
        CrosspostLink,
        r#"
        SELECT service, external_uri as "external_uri!"
        FROM crossposts
        WHERE occurrence_uri = $1 AND external_uri IS NOT NULL
        ORDER BY created_at
        "#,
        occurrence_uri,
    )
    .fetch_all(executor)
    .await
}

/// Queue an occurrence for cross-posting, or requeue one that `failed`.
/// Returns `false`, changing nothing, when it is already `pending` or `synced`.
///
/// `awaits_uris` are records the ingester must index before the crosspost may
/// run: when queuing in the request that created the occurrence, every record
/// it wrote; for an occurrence that is already indexed, none. It isn't claimed
/// before `not_before`, when given.
pub async fn enqueue(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    service: &str,
    did: &str,
    awaits_uris: &[String],
    not_before: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        INSERT INTO crossposts (occurrence_uri, service, did, status, awaits_uris, not_before)
        VALUES ($1, $2, $3, 'pending', $4, $5)
        ON CONFLICT (occurrence_uri, service) DO UPDATE SET
            status = 'pending',
            attempts = 0,
            last_error = NULL,
            awaits_uris = EXCLUDED.awaits_uris,
            waits = 0,
            not_before = EXCLUDED.not_before,
            updated_at = NOW()
        WHERE crossposts.status = 'failed'
        "#,
        occurrence_uri,
        service,
        did,
        awaits_uris,
        not_before,
    )
    .execute(executor)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Claim up to `limit` pending crossposts whose backoff has elapsed, and whose
/// `not_before` has passed, counting the attempt. The backoff is 30s after the
/// first attempt and roughly doubles from there, which also keeps a second
/// worker off a job that is in flight.
pub async fn claim_pending(
    executor: impl sqlx::PgExecutor<'_>,
    service: &str,
    limit: i64,
) -> Result<Vec<CrosspostRow>, sqlx::Error> {
    sqlx::query_as!(
        CrosspostRow,
        r#"
        UPDATE crossposts
        SET attempts = attempts + 1, updated_at = NOW()
        WHERE (occurrence_uri, service) IN (
            SELECT occurrence_uri, service
            FROM crossposts
            WHERE service = $1
              AND status = 'pending'
              AND updated_at <= NOW() - make_interval(secs => 30 * (2 ^ attempts - 1))
              AND (not_before IS NULL OR not_before <= NOW())
            ORDER BY updated_at
            LIMIT $2
            FOR UPDATE SKIP LOCKED
        )
        RETURNING occurrence_uri, service, did, external_uri, synced_blob_cids,
                  status, attempts, last_error, awaits_uris, waits
        "#,
        service,
        limit,
    )
    .fetch_all(executor)
    .await
}

/// When the next pending crosspost's backoff runs out: the earliest time
/// [`claim_pending`] would hand one out. `None` when nothing is pending.
///
/// The backoff and `not_before` are the same as `claim_pending`'s; keep them
/// in step (`GREATEST` skips a NULL `not_before`). A runtime query rather than
/// `query!`, so it needs no `.sqlx` entry.
pub async fn next_due_at(
    executor: impl sqlx::PgExecutor<'_>,
    service: &str,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT MIN(GREATEST(
            updated_at + make_interval(secs => 30 * (2 ^ attempts - 1)),
            not_before
        ))
        FROM crossposts
        WHERE service = $1 AND status = 'pending'
        "#,
    )
    .bind(service)
    .fetch_one(executor)
    .await
}

/// How much of the queue is pending, and since when the oldest of it has been.
#[derive(Debug, PartialEq, Eq)]
pub struct QueueStats {
    pub pending: i64,
    pub oldest: Option<chrono::DateTime<chrono::Utc>>,
}

/// A runtime query rather than `query!`, so it needs no `.sqlx` entry.
pub async fn queue_stats(
    executor: impl sqlx::PgExecutor<'_>,
    service: &str,
) -> Result<QueueStats, sqlx::Error> {
    let (pending, oldest) = sqlx::query_as(
        r#"
        SELECT COUNT(*), MIN(created_at)
        FROM crossposts
        WHERE service = $1 AND status = 'pending'
        "#,
    )
    .bind(service)
    .fetch_one(executor)
    .await?;
    Ok(QueueStats { pending, oldest })
}

/// Whether the ingester has indexed every one of `uris`: occurrences,
/// identifications, and remarks, the records a crosspost reads. They can be
/// indexed in any order (see `20260602000000_drop_occurrence_ref_fks.sql`), so
/// each is checked, not just the last one written.
pub async fn all_indexed(
    executor: impl sqlx::PgExecutor<'_>,
    uris: &[String],
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT NOT EXISTS (
            SELECT 1 FROM UNNEST($1::text[]) AS awaited(uri)
            WHERE NOT EXISTS (SELECT 1 FROM occurrences WHERE uri = awaited.uri)
              AND NOT EXISTS (SELECT 1 FROM identifications WHERE uri = awaited.uri)
              AND NOT EXISTS (SELECT 1 FROM remarks WHERE uri = awaited.uri)
        ) as "indexed!"
        "#,
        uris,
    )
    .fetch_one(executor)
    .await
}

/// Put a claimed crosspost back to check on the ingester again after `delay`,
/// giving back the attempt its claim counted.
pub async fn defer(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    service: &str,
    delay: chrono::Duration,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE crossposts
        SET attempts = GREATEST(attempts - 1, 0),
            waits = waits + 1,
            not_before = NOW() + make_interval(secs => $3),
            updated_at = NOW()
        WHERE occurrence_uri = $1 AND service = $2 AND status = 'pending'
        "#,
        occurrence_uri,
        service,
        delay.as_seconds_f64(),
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Stop waiting on the ingester: everything the crosspost awaited is indexed.
pub async fn clear_awaits(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    service: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE crossposts SET awaits_uris = '{}'
        WHERE occurrence_uri = $1 AND service = $2
        "#,
        occurrence_uri,
        service,
    )
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn set_external_uri(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    service: &str,
    external_uri: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE crossposts SET external_uri = $3, updated_at = NOW()
        WHERE occurrence_uri = $1 AND service = $2
        "#,
        occurrence_uri,
        service,
        external_uri,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Record that one of the occurrence's photos has been posted.
pub async fn add_synced_blob(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    service: &str,
    blob_cid: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE crossposts
        SET synced_blob_cids = array_append(synced_blob_cids, $3), updated_at = NOW()
        WHERE occurrence_uri = $1 AND service = $2 AND NOT ($3 = ANY(synced_blob_cids))
        "#,
        occurrence_uri,
        service,
        blob_cid,
    )
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn mark_synced(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    service: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE crossposts SET status = 'synced', last_error = NULL, updated_at = NOW()
        WHERE occurrence_uri = $1 AND service = $2 AND status = 'pending'
        "#,
        occurrence_uri,
        service,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Record why an attempt failed. The crosspost stays `pending` for another
/// attempt until it has been tried `max_attempts` times, then becomes `failed`;
/// pass 0 to fail it now.
///
/// Like [`mark_synced`], this only touches a `pending` crosspost, so a worker
/// that held a job past its lease can't undo the outcome another one recorded.
pub async fn record_failure(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    service: &str,
    error: &str,
    max_attempts: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE crossposts
        SET last_error = $3,
            status = CASE WHEN attempts >= $4 THEN 'failed' ELSE 'pending' END,
            updated_at = NOW()
        WHERE occurrence_uri = $1 AND service = $2 AND status = 'pending'
        "#,
        occurrence_uri,
        service,
        error,
        max_attempts,
    )
    .execute(executor)
    .await?;
    Ok(())
}
