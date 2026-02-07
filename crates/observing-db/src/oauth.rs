use sqlx::PgPool;

// OAuth state methods (for PKCE flow, short-lived)

/// Get OAuth state value (only if not expired)
pub async fn get_state(pool: &PgPool, key: &str) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT value FROM oauth_state WHERE key = $1 AND expires_at > NOW()",
    )
    .bind(key)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

/// Set OAuth state with TTL (in milliseconds)
pub async fn set_state(
    pool: &PgPool,
    key: &str,
    value: &str,
    ttl_ms: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO oauth_state (key, value, expires_at)
        VALUES ($1, $2, NOW() + ($3 || ' milliseconds')::interval)
        ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = NOW() + ($3 || ' milliseconds')::interval
        "#,
    )
    .bind(key)
    .bind(value)
    .bind(ttl_ms.to_string())
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete OAuth state
pub async fn delete_state(pool: &PgPool, key: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM oauth_state WHERE key = $1")
        .bind(key)
        .execute(pool)
        .await?;
    Ok(())
}

/// Clean up expired OAuth state entries
pub async fn cleanup_expired_state(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM oauth_state WHERE expires_at < NOW()")
        .execute(pool)
        .await?;
    Ok(())
}

// OAuth session methods (stores AT Protocol client session as JSON)

/// Get OAuth session value
pub async fn get_session(pool: &PgPool, key: &str) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM oauth_sessions WHERE key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.0))
}

/// Set OAuth session value
pub async fn set_session(pool: &PgPool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO oauth_sessions (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = $2
        "#,
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete OAuth session
pub async fn delete_session(pool: &PgPool, key: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM oauth_sessions WHERE key = $1")
        .bind(key)
        .execute(pool)
        .await?;
    Ok(())
}
