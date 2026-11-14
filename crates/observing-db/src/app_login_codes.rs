//! One-time codes that hand an app's sign-in back to it: the SHA-256 of a
//! random code mapped to the DID it signs in as and the app's PKCE challenge.
//! Callers hash the code; the code itself never reaches the database.

use chrono::{DateTime, Utc};

/// A code taken from the table: who it signs in as and the challenge its
/// verifier must answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoginCode {
    pub did: String,
    pub code_challenge: String,
}

/// Store a new code for `did`, expiring at `expires_at`.
pub async fn create(
    executor: impl sqlx::PgExecutor<'_>,
    code_hash: &[u8],
    did: &str,
    code_challenge: &str,
    expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO appview.app_login_codes (code_hash, did, code_challenge, expires_at)
        VALUES ($1, $2, $3, $4)
        "#,
        code_hash,
        did,
        code_challenge,
        expires_at,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Take the code with this hash: it is deleted whatever happens next, so it
/// works at most once. `None` if there is no such code or it has expired.
pub async fn take(
    executor: impl sqlx::PgExecutor<'_>,
    code_hash: &[u8],
) -> Result<Option<LoginCode>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        DELETE FROM appview.app_login_codes
        WHERE code_hash = $1
        RETURNING did, code_challenge, expires_at > NOW() AS "live!"
        "#,
        code_hash,
    )
    .fetch_optional(executor)
    .await?;
    Ok(row.filter(|r| r.live).map(|r| LoginCode {
        did: r.did,
        code_challenge: r.code_challenge,
    }))
}

/// Delete codes that expired before now.
pub async fn delete_expired(executor: impl sqlx::PgExecutor<'_>) -> Result<u64, sqlx::Error> {
    let result = sqlx::query!("DELETE FROM appview.app_login_codes WHERE expires_at <= NOW()")
        .execute(executor)
        .await?;
    Ok(result.rows_affected())
}
