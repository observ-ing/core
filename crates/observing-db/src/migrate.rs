use sqlx::PgPool;
use tracing::info;

/// Run all database migrations (versioned, tracked in `_sqlx_migrations` table)
pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    info!("Running database migrations...");
    sqlx::migrate!()
        .run(pool)
        .await
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
    info!("Database migrations completed");
    Ok(())
}
