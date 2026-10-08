//! Cross-posting occurrences to other platforms: the accounts users have
//! linked, and the queue of occurrences to post.
//!
//! A crosspost is `pending` until it is posted (`synced`) or has been tried
//! `max_attempts` times (`failed`). Every attempt is counted when it is
//! claimed, not when it ends, so a job whose worker died still backs off.

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
               status, attempts, last_error
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
pub async fn enqueue(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    service: &str,
    did: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        INSERT INTO crossposts (occurrence_uri, service, did, status)
        VALUES ($1, $2, $3, 'pending')
        ON CONFLICT (occurrence_uri, service) DO UPDATE SET
            status = 'pending',
            attempts = 0,
            last_error = NULL,
            updated_at = NOW()
        WHERE crossposts.status = 'failed'
        "#,
        occurrence_uri,
        service,
        did,
    )
    .execute(executor)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Claim up to `limit` pending crossposts whose backoff has elapsed, counting
/// the attempt. The backoff is 30s after the first attempt and roughly doubles
/// from there, which also keeps a second worker off a job that is in flight.
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
            ORDER BY updated_at
            LIMIT $2
            FOR UPDATE SKIP LOCKED
        )
        RETURNING occurrence_uri, service, did, external_uri, synced_blob_cids,
                  status, attempts, last_error
        "#,
        service,
        limit,
    )
    .fetch_all(executor)
    .await
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
        WHERE occurrence_uri = $1 AND service = $2
        "#,
        occurrence_uri,
        service,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Record why an attempt failed. The crosspost stays `pending` for another
/// attempt until it has been tried `max_attempts` times, then becomes `failed`.
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
        WHERE occurrence_uri = $1 AND service = $2
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
