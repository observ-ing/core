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

        // Extract fields from record JSON to match existing Darwin Core schema
        let record = event.record.as_ref();
        let scientific_name = record
            .and_then(|r| r.get("scientificName"))
            .and_then(|v| v.as_str());
        let event_date = record
            .and_then(|r| r.get("eventDate"))
            .and_then(|v| v.as_str());
        let created_at = record
            .and_then(|r| r.get("createdAt"))
            .and_then(|v| v.as_str());
        let verbatim_locality = record
            .and_then(|r| r.get("verbatimLocality"))
            .and_then(|v| v.as_str());
        let notes = record
            .and_then(|r| r.get("notes"))
            .and_then(|v| v.as_str());
        let blobs = record.and_then(|r| r.get("blobs"));

        // Extract location
        let location = record.and_then(|r| r.get("location"));
        let lat = location
            .and_then(|l| l.get("decimalLatitude"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok());
        let lng = location
            .and_then(|l| l.get("decimalLongitude"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok());
        let coord_uncertainty = location
            .and_then(|l| l.get("coordinateUncertaintyInMeters"))
            .and_then(|v| v.as_i64())
            .map(|v| v as i32);

        // Require lat/lng and event_date
        let (lat, lng) = match (lat, lng) {
            (Some(lat), Some(lng)) => (lat, lng),
            _ => {
                debug!("Skipping occurrence without valid coordinates: {}", event.uri);
                return Ok(());
            }
        };
        let event_date = match event_date {
            Some(d) => d,
            None => {
                debug!("Skipping occurrence without eventDate: {}", event.uri);
                return Ok(());
            }
        };
        let created_at = created_at.unwrap_or(event_date);

        sqlx::query(
            r#"
            INSERT INTO occurrences (
                uri, did, cid, scientific_name, event_date, location,
                coordinate_uncertainty_meters, verbatim_locality, occurrence_remarks,
                associated_media, created_at, indexed_at
            )
            VALUES (
                $1, $2, $3, $4, $5::timestamptz, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
                $8, $9, $10, $11, $12::timestamptz, NOW()
            )
            ON CONFLICT (uri) DO UPDATE SET
                cid = EXCLUDED.cid,
                scientific_name = EXCLUDED.scientific_name,
                event_date = EXCLUDED.event_date,
                location = EXCLUDED.location,
                coordinate_uncertainty_meters = EXCLUDED.coordinate_uncertainty_meters,
                verbatim_locality = EXCLUDED.verbatim_locality,
                occurrence_remarks = EXCLUDED.occurrence_remarks,
                associated_media = EXCLUDED.associated_media,
                indexed_at = NOW()
            "#,
        )
        .bind(&event.uri)
        .bind(&event.did)
        .bind(&event.cid)
        .bind(scientific_name)
        .bind(event_date)
        .bind(lng) // ST_MakePoint takes (x, y) = (lng, lat)
        .bind(lat)
        .bind(coord_uncertainty)
        .bind(verbatim_locality)
        .bind(notes)
        .bind(blobs)
        .bind(created_at)
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

        // Extract fields from record JSON to match existing schema
        let record = event.record.as_ref();
        let subject = record.and_then(|r| r.get("subject"));
        let subject_uri = subject
            .and_then(|s| s.get("uri"))
            .and_then(|v| v.as_str());
        let subject_cid = subject
            .and_then(|s| s.get("cid"))
            .and_then(|v| v.as_str());
        let taxon_name = record
            .and_then(|r| r.get("taxonName"))
            .and_then(|v| v.as_str());
        let taxon_rank = record
            .and_then(|r| r.get("taxonRank"))
            .and_then(|v| v.as_str());
        let comment = record
            .and_then(|r| r.get("comment"))
            .and_then(|v| v.as_str());
        let is_agreement = record
            .and_then(|r| r.get("isAgreement"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let created_at = record
            .and_then(|r| r.get("createdAt"))
            .and_then(|v| v.as_str());

        // Require subject and taxon_name
        let subject_uri = match subject_uri {
            Some(uri) => uri,
            None => {
                debug!("Skipping identification without subject uri: {}", event.uri);
                return Ok(());
            }
        };
        let subject_cid = subject_cid.unwrap_or("");
        let taxon_name = match taxon_name {
            Some(name) => name,
            None => {
                debug!("Skipping identification without taxonName: {}", event.uri);
                return Ok(());
            }
        };
        let fallback_date = event.time.to_rfc3339();
        let date_identified = created_at.unwrap_or(&fallback_date);

        sqlx::query(
            r#"
            INSERT INTO identifications (
                uri, did, cid, subject_uri, subject_cid, scientific_name,
                taxon_rank, identification_remarks, is_agreement, date_identified, indexed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, NOW())
            ON CONFLICT (uri) DO UPDATE SET
                cid = EXCLUDED.cid,
                subject_uri = EXCLUDED.subject_uri,
                subject_cid = EXCLUDED.subject_cid,
                scientific_name = EXCLUDED.scientific_name,
                taxon_rank = EXCLUDED.taxon_rank,
                identification_remarks = EXCLUDED.identification_remarks,
                is_agreement = EXCLUDED.is_agreement,
                date_identified = EXCLUDED.date_identified,
                indexed_at = NOW()
            "#,
        )
        .bind(&event.uri)
        .bind(&event.did)
        .bind(&event.cid)
        .bind(subject_uri)
        .bind(subject_cid)
        .bind(taxon_name)
        .bind(taxon_rank)
        .bind(comment)
        .bind(is_agreement)
        .bind(date_identified)
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
