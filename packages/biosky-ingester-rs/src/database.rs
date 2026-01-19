//! Database layer for the BioSky ingester
//!
//! Uses sqlx with PostgreSQL for storing occurrences, identifications, and cursor state.

use crate::error::Result;
use crate::types::{IdentificationEvent, OccurrenceEvent};
use sqlx::postgres::{PgPool, PgPoolOptions};
use tracing::{debug, info};

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

    /// Run database migrations
    pub async fn migrate(&self) -> Result<()> {
        info!("Running database migrations...");

        // Create occurrences table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS occurrences (
                uri TEXT PRIMARY KEY,
                did TEXT NOT NULL,
                cid TEXT NOT NULL,
                record JSONB,
                indexed_at TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Create identifications table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS identifications (
                uri TEXT PRIMARY KEY,
                did TEXT NOT NULL,
                cid TEXT NOT NULL,
                record JSONB,
                indexed_at TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Create cursor table for resumption (use TEXT for compatibility with existing schema)
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS ingester_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Create indexes
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_occurrences_did ON occurrences(did)")
            .execute(&self.pool)
            .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_identifications_did ON identifications(did)")
            .execute(&self.pool)
            .await?;

        info!("Database migrations complete");
        Ok(())
    }

    /// Upsert an occurrence record
    pub async fn upsert_occurrence(&self, event: &OccurrenceEvent) -> Result<()> {
        debug!("Upserting occurrence: {}", event.uri);
        sqlx::query(
            r#"
            INSERT INTO occurrences (uri, did, cid, record, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (uri) DO UPDATE SET
                cid = EXCLUDED.cid,
                record = EXCLUDED.record,
                updated_at = NOW()
            "#,
        )
        .bind(&event.uri)
        .bind(&event.did)
        .bind(&event.cid)
        .bind(&event.record)
        .bind(&event.time)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Delete an occurrence record
    pub async fn delete_occurrence(&self, uri: &str) -> Result<()> {
        debug!("Deleting occurrence: {}", uri);
        sqlx::query("DELETE FROM occurrences WHERE uri = $1")
            .bind(uri)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Upsert an identification record
    pub async fn upsert_identification(&self, event: &IdentificationEvent) -> Result<()> {
        debug!("Upserting identification: {}", event.uri);
        sqlx::query(
            r#"
            INSERT INTO identifications (uri, did, cid, record, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (uri) DO UPDATE SET
                cid = EXCLUDED.cid,
                record = EXCLUDED.record,
                updated_at = NOW()
            "#,
        )
        .bind(&event.uri)
        .bind(&event.did)
        .bind(&event.cid)
        .bind(&event.record)
        .bind(&event.time)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Delete an identification record
    pub async fn delete_identification(&self, uri: &str) -> Result<()> {
        debug!("Deleting identification: {}", uri);
        sqlx::query("DELETE FROM identifications WHERE uri = $1")
            .bind(uri)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Get the saved cursor for resumption
    pub async fn get_cursor(&self) -> Result<Option<i64>> {
        // Value is stored as TEXT for compatibility with existing schema
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM ingester_state WHERE key = 'cursor'")
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.and_then(|(v,)| v.parse::<i64>().ok()))
    }

    /// Save the cursor for resumption
    pub async fn save_cursor(&self, cursor: i64) -> Result<()> {
        // Value is stored as TEXT for compatibility with existing schema
        sqlx::query(
            r#"
            INSERT INTO ingester_state (key, value, updated_at)
            VALUES ('cursor', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = NOW()
            "#,
        )
        .bind(cursor.to_string())
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

#[cfg(test)]
mod tests {
    // Integration tests would require a test database
    // Unit tests for query building could go here
}
