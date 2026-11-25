//! Appview sign-in sessions: the SHA-256 of an opaque session token mapped
//! to the DID it signs in as. Callers hash the token; the token itself never
//! reaches the database.

use chrono::{DateTime, Utc};

/// Store a new session for `did`, expiring at `expires_at`.
pub async fn create(
    executor: impl sqlx::PgExecutor<'_>,
    token_hash: &[u8],
    did: &str,
    expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO appview.app_sessions (token_hash, did, expires_at)
        VALUES ($1, $2, $3)
        "#,
        token_hash,
        did,
        expires_at,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// The DID signed in by the session with this token hash, or `None` if there
/// is no such session or it has expired. Marks the session as used.
pub async fn lookup(
    executor: impl sqlx::PgExecutor<'_>,
    token_hash: &[u8],
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        UPDATE appview.app_sessions
        SET last_used_at = NOW()
        WHERE token_hash = $1 AND expires_at > NOW()
        RETURNING did
        "#,
        token_hash,
    )
    .fetch_optional(executor)
    .await?;
    Ok(row.map(|r| r.did))
}

/// Delete the session with this token hash (sign out). Returns the DID it
/// signed in as, or `None` if there was no such session.
pub async fn delete(
    executor: impl sqlx::PgExecutor<'_>,
    token_hash: &[u8],
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query!(
        "DELETE FROM appview.app_sessions WHERE token_hash = $1 RETURNING did",
        token_hash,
    )
    .fetch_optional(executor)
    .await?;
    Ok(row.map(|r| r.did))
}

/// Delete every session for `did` (sign out everywhere). Returns how many
/// sessions were deleted.
pub async fn delete_all_for_did(
    executor: impl sqlx::PgExecutor<'_>,
    did: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!("DELETE FROM appview.app_sessions WHERE did = $1", did)
        .execute(executor)
        .await?;
    Ok(result.rows_affected())
}

/// Delete sessions that expired before now.
pub async fn delete_expired(executor: impl sqlx::PgExecutor<'_>) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!("DELETE FROM appview.app_sessions WHERE expires_at <= NOW()")
        .execute(executor)
        .await?;
    Ok(result.rows_affected())
}
