//! Database layer for the Observ.ing ingester
//!
//! Uses sqlx with PostgreSQL for storing occurrences, identifications, and cursor state.

use crate::error::Result;
use crate::types::{CommentEvent, IdentificationEvent, OccurrenceEvent};
use chrono::{DateTime, NaiveDateTime, Utc};
use sqlx::postgres::{PgPool, PgPoolOptions};
use tracing::{debug, info};

/// Parse an ISO 8601 date string into a DateTime<Utc>
fn parse_datetime(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
}

/// Parse an ISO 8601 date string into a NaiveDateTime (for timestamp columns without timezone)
fn parse_naive_datetime(s: &str) -> Option<NaiveDateTime> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.naive_utc())
        .ok()
}

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
        let notes = record.and_then(|r| r.get("notes")).and_then(|v| v.as_str());
        let associated_media = record.and_then(|r| r.get("associatedMedia"));

        // Extract taxonomy fields
        let taxon_id = record
            .and_then(|r| r.get("taxonId"))
            .and_then(|v| v.as_str());
        let taxon_rank = record
            .and_then(|r| r.get("taxonRank"))
            .and_then(|v| v.as_str());
        let vernacular_name = record
            .and_then(|r| r.get("vernacularName"))
            .and_then(|v| v.as_str());
        let kingdom = record
            .and_then(|r| r.get("kingdom"))
            .and_then(|v| v.as_str());
        let phylum = record
            .and_then(|r| r.get("phylum"))
            .and_then(|v| v.as_str());
        let class = record.and_then(|r| r.get("class")).and_then(|v| v.as_str());
        let order = record.and_then(|r| r.get("order")).and_then(|v| v.as_str());
        let family = record
            .and_then(|r| r.get("family"))
            .and_then(|v| v.as_str());
        let genus = record.and_then(|r| r.get("genus")).and_then(|v| v.as_str());

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

        // Extract Darwin Core administrative geography fields
        let continent = location
            .and_then(|l| l.get("continent"))
            .and_then(|v| v.as_str());
        let country = location
            .and_then(|l| l.get("country"))
            .and_then(|v| v.as_str());
        let country_code = location
            .and_then(|l| l.get("countryCode"))
            .and_then(|v| v.as_str());
        let state_province = location
            .and_then(|l| l.get("stateProvince"))
            .and_then(|v| v.as_str());
        let county = location
            .and_then(|l| l.get("county"))
            .and_then(|v| v.as_str());
        let municipality = location
            .and_then(|l| l.get("municipality"))
            .and_then(|v| v.as_str());
        let locality = location
            .and_then(|l| l.get("locality"))
            .and_then(|v| v.as_str());
        let water_body = location
            .and_then(|l| l.get("waterBody"))
            .and_then(|v| v.as_str());

        // Require lat/lng and event_date
        let (lat, lng) = match (lat, lng) {
            (Some(lat), Some(lng)) => (lat, lng),
            _ => {
                debug!(
                    "Skipping occurrence without valid coordinates: {}",
                    event.uri
                );
                return Ok(());
            }
        };
        let event_date = match event_date.and_then(parse_datetime) {
            Some(d) => d,
            None => {
                debug!("Skipping occurrence without valid eventDate: {}", event.uri);
                return Ok(());
            }
        };
        let created_at = created_at.and_then(parse_datetime).unwrap_or(event_date);

        sqlx::query!(
            r#"
            INSERT INTO occurrences (
                uri, did, cid, scientific_name, event_date, location,
                coordinate_uncertainty_meters,
                continent, country, country_code, state_province, county, municipality, locality, water_body,
                verbatim_locality, occurrence_remarks,
                associated_media, created_at, indexed_at,
                taxon_id, taxon_rank, vernacular_name, kingdom, phylum, class, "order", family, genus
            )
            VALUES (
                $1, $2, $3, $4, $5::timestamptz, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
                $8, $9, $10, $11, $12, $13, $14, $15, $16,
                $17, $18, $19, $20::timestamptz, NOW(),
                $21, $22, $23, $24, $25, $26, $27, $28, $29
            )
            ON CONFLICT (uri) DO UPDATE SET
                cid = EXCLUDED.cid,
                scientific_name = EXCLUDED.scientific_name,
                event_date = EXCLUDED.event_date,
                location = EXCLUDED.location,
                coordinate_uncertainty_meters = EXCLUDED.coordinate_uncertainty_meters,
                continent = EXCLUDED.continent,
                country = EXCLUDED.country,
                country_code = EXCLUDED.country_code,
                state_province = EXCLUDED.state_province,
                county = EXCLUDED.county,
                municipality = EXCLUDED.municipality,
                locality = EXCLUDED.locality,
                water_body = EXCLUDED.water_body,
                verbatim_locality = EXCLUDED.verbatim_locality,
                occurrence_remarks = EXCLUDED.occurrence_remarks,
                associated_media = EXCLUDED.associated_media,
                indexed_at = NOW(),
                taxon_id = EXCLUDED.taxon_id,
                taxon_rank = EXCLUDED.taxon_rank,
                vernacular_name = EXCLUDED.vernacular_name,
                kingdom = EXCLUDED.kingdom,
                phylum = EXCLUDED.phylum,
                class = EXCLUDED.class,
                "order" = EXCLUDED."order",
                family = EXCLUDED.family,
                genus = EXCLUDED.genus
            "#,
            &event.uri,
            &event.did,
            &event.cid,
            scientific_name,
            event_date,
            lng, // ST_MakePoint takes (x, y) = (lng, lat)
            lat,
            coord_uncertainty,
            continent,
            country,
            country_code,
            state_province,
            county,
            municipality,
            locality,
            water_body,
            verbatim_locality,
            notes,
            associated_media,
            created_at,
            taxon_id,
            taxon_rank,
            vernacular_name,
            kingdom,
            phylum,
            class,
            order,
            family,
            genus
        )
        .execute(&self.pool)
        .await?;

        // Sync occurrence_observers table
        // First, delete existing observers for this occurrence
        sqlx::query!(
            "DELETE FROM occurrence_observers WHERE occurrence_uri = $1",
            &event.uri
        )
        .execute(&self.pool)
        .await?;

        // Insert owner
        sqlx::query!(
            r#"
            INSERT INTO occurrence_observers (occurrence_uri, observer_did, role)
            VALUES ($1, $2, 'owner')
            ON CONFLICT (occurrence_uri, observer_did) DO NOTHING
            "#,
            &event.uri,
            &event.did
        )
        .execute(&self.pool)
        .await?;

        // Extract and insert co-observers from recordedBy array
        if let Some(recorded_by) = record
            .and_then(|r| r.get("recordedBy"))
            .and_then(|v| v.as_array())
        {
            for did_value in recorded_by {
                if let Some(co_observer_did) = did_value.as_str() {
                    // Don't add owner as co-observer
                    if co_observer_did != event.did {
                        sqlx::query!(
                            r#"
                            INSERT INTO occurrence_observers (occurrence_uri, observer_did, role)
                            VALUES ($1, $2, 'co-observer')
                            ON CONFLICT (occurrence_uri, observer_did) DO NOTHING
                            "#,
                            &event.uri,
                            co_observer_did
                        )
                        .execute(&self.pool)
                        .await?;
                    }
                }
            }
        }

        Ok(())
    }

    /// Delete an occurrence record
    pub async fn delete_occurrence(&self, uri: &str) -> Result<()> {
        debug!("Deleting occurrence: {}", uri);
        sqlx::query!("DELETE FROM occurrences WHERE uri = $1", uri)
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
        let subject_uri = subject.and_then(|s| s.get("uri")).and_then(|v| v.as_str());
        let subject_cid = subject.and_then(|s| s.get("cid")).and_then(|v| v.as_str());
        let subject_index = record
            .and_then(|r| r.get("subjectIndex"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
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
        let date_identified = created_at
            .and_then(parse_naive_datetime)
            .unwrap_or_else(|| event.time.naive_utc());

        sqlx::query!(
            r#"
            INSERT INTO identifications (
                uri, did, cid, subject_uri, subject_cid, subject_index, scientific_name,
                taxon_rank, identification_remarks, is_agreement, date_identified, indexed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
            ON CONFLICT (uri) DO UPDATE SET
                cid = EXCLUDED.cid,
                subject_uri = EXCLUDED.subject_uri,
                subject_cid = EXCLUDED.subject_cid,
                subject_index = EXCLUDED.subject_index,
                scientific_name = EXCLUDED.scientific_name,
                taxon_rank = EXCLUDED.taxon_rank,
                identification_remarks = EXCLUDED.identification_remarks,
                is_agreement = EXCLUDED.is_agreement,
                date_identified = EXCLUDED.date_identified,
                indexed_at = NOW()
            "#,
            &event.uri,
            &event.did,
            &event.cid,
            subject_uri,
            subject_cid,
            subject_index,
            taxon_name,
            taxon_rank,
            comment,
            is_agreement,
            date_identified
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Delete an identification record
    pub async fn delete_identification(&self, uri: &str) -> Result<()> {
        debug!("Deleting identification: {}", uri);
        sqlx::query!("DELETE FROM identifications WHERE uri = $1", uri)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Upsert a comment record
    pub async fn upsert_comment(&self, event: &CommentEvent) -> Result<()> {
        debug!("Upserting comment: {}", event.uri);

        // Extract fields from record JSON
        let record = event.record.as_ref();
        let subject = record.and_then(|r| r.get("subject"));
        let subject_uri = subject.and_then(|s| s.get("uri")).and_then(|v| v.as_str());
        let subject_cid = subject.and_then(|s| s.get("cid")).and_then(|v| v.as_str());
        let body = record.and_then(|r| r.get("body")).and_then(|v| v.as_str());
        let reply_to = record.and_then(|r| r.get("replyTo"));
        let reply_to_uri = reply_to.and_then(|s| s.get("uri")).and_then(|v| v.as_str());
        let reply_to_cid = reply_to.and_then(|s| s.get("cid")).and_then(|v| v.as_str());
        let created_at = record
            .and_then(|r| r.get("createdAt"))
            .and_then(|v| v.as_str());

        // Require subject and body
        let subject_uri = match subject_uri {
            Some(uri) => uri,
            None => {
                debug!("Skipping comment without subject uri: {}", event.uri);
                return Ok(());
            }
        };
        let subject_cid = subject_cid.unwrap_or("");
        let body = match body {
            Some(b) => b,
            None => {
                debug!("Skipping comment without body: {}", event.uri);
                return Ok(());
            }
        };
        let created_at = created_at
            .and_then(parse_naive_datetime)
            .unwrap_or_else(|| event.time.naive_utc());

        sqlx::query!(
            r#"
            INSERT INTO comments (
                uri, did, cid, subject_uri, subject_cid, body,
                reply_to_uri, reply_to_cid, created_at, indexed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (uri) DO UPDATE SET
                cid = EXCLUDED.cid,
                subject_uri = EXCLUDED.subject_uri,
                subject_cid = EXCLUDED.subject_cid,
                body = EXCLUDED.body,
                reply_to_uri = EXCLUDED.reply_to_uri,
                reply_to_cid = EXCLUDED.reply_to_cid,
                created_at = EXCLUDED.created_at,
                indexed_at = NOW()
            "#,
            &event.uri,
            &event.did,
            &event.cid,
            subject_uri,
            subject_cid,
            body,
            reply_to_uri,
            reply_to_cid,
            created_at
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Delete a comment record
    pub async fn delete_comment(&self, uri: &str) -> Result<()> {
        debug!("Deleting comment: {}", uri);
        sqlx::query!("DELETE FROM comments WHERE uri = $1", uri)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Get the saved cursor for resumption
    pub async fn get_cursor(&self) -> Result<Option<i64>> {
        // Value is stored as TEXT for compatibility with existing schema
        let row = sqlx::query!("SELECT value FROM ingester_state WHERE key = 'cursor'")
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.and_then(|r| r.value.parse::<i64>().ok()))
    }

    /// Save the cursor for resumption
    pub async fn save_cursor(&self, cursor: i64) -> Result<()> {
        // Value is stored as TEXT for compatibility with existing schema
        let cursor_str = cursor.to_string();
        sqlx::query!(
            r#"
            INSERT INTO ingester_state (key, value, updated_at)
            VALUES ('cursor', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = NOW()
            "#,
            cursor_str
        )
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
