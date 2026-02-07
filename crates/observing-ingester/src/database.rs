//! Database layer for the Observ.ing ingester
//!
//! Extracts fields from raw firehose JSON events and delegates to
//! the shared `observing-db` crate for SQL execution.

use crate::error::Result;
use crate::types::{
    CommentEvent, IdentificationEvent, InteractionEvent, LikeEvent, OccurrenceEvent,
};
use chrono::{DateTime, NaiveDateTime, Utc};
use observing_db::types::{
    CreateLikeParams, UpsertCommentParams, UpsertIdentificationParams, UpsertInteractionParams,
    UpsertOccurrenceParams,
};
use sqlx::postgres::{PgPool, PgPoolOptions};
use tracing::{debug, info, warn};

/// Parse an ISO 8601 date string into a DateTime<Utc>
fn parse_datetime(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
}

/// Parse an ISO 8601 date string into a NaiveDateTime
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

    /// Run database migrations using the shared migration
    pub async fn migrate(&self) -> Result<()> {
        observing_db::migrate::migrate(&self.pool).await?;
        Ok(())
    }

    /// Upsert an occurrence record
    pub async fn upsert_occurrence(&self, event: &OccurrenceEvent) -> Result<()> {
        debug!("Upserting occurrence: {}", event.uri);

        // Extract fields from record JSON
        let record = event.record.as_ref();
        let scientific_name = record
            .and_then(|r| r.get("scientificName"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let event_date = record
            .and_then(|r| r.get("eventDate"))
            .and_then(|v| v.as_str());
        let created_at = record
            .and_then(|r| r.get("createdAt"))
            .and_then(|v| v.as_str());
        let verbatim_locality = record
            .and_then(|r| r.get("verbatimLocality"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let notes = record
            .and_then(|r| r.get("notes"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let associated_media = record.and_then(|r| r.get("blobs")).cloned();

        // Extract taxonomy fields
        let taxon_id = record
            .and_then(|r| r.get("taxonId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let taxon_rank = record
            .and_then(|r| r.get("taxonRank"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let vernacular_name = record
            .and_then(|r| r.get("vernacularName"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let kingdom = record
            .and_then(|r| r.get("kingdom"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let phylum = record
            .and_then(|r| r.get("phylum"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let class = record
            .and_then(|r| r.get("class"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let order = record
            .and_then(|r| r.get("order"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let family = record
            .and_then(|r| r.get("family"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let genus = record
            .and_then(|r| r.get("genus"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

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
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let country = location
            .and_then(|l| l.get("country"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let country_code = location
            .and_then(|l| l.get("countryCode"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let state_province = location
            .and_then(|l| l.get("stateProvince"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let county_val = location
            .and_then(|l| l.get("county"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let municipality = location
            .and_then(|l| l.get("municipality"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let locality_val = location
            .and_then(|l| l.get("locality"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let water_body = location
            .and_then(|l| l.get("waterBody"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Require lat/lng and event_date
        let (lat, lng) = match (lat, lng) {
            (Some(lat), Some(lng)) => (lat, lng),
            _ => {
                warn!(uri = %event.uri, "Skipping occurrence without valid coordinates");
                return Ok(());
            }
        };
        let event_date = match event_date.and_then(parse_datetime) {
            Some(d) => d,
            None => {
                warn!(uri = %event.uri, "Skipping occurrence without valid eventDate");
                return Ok(());
            }
        };
        let created_at = created_at.and_then(parse_datetime).unwrap_or(event_date);

        let params = UpsertOccurrenceParams {
            uri: event.uri.clone(),
            cid: event.cid.clone(),
            did: event.did.clone(),
            scientific_name,
            event_date,
            longitude: lng,
            latitude: lat,
            coordinate_uncertainty_meters: coord_uncertainty,
            continent,
            country,
            country_code,
            state_province,
            county: county_val,
            municipality,
            locality: locality_val,
            water_body,
            verbatim_locality,
            occurrence_remarks: notes,
            associated_media,
            recorded_by: None,
            taxon_id,
            taxon_rank,
            vernacular_name,
            kingdom,
            phylum,
            class,
            order,
            family,
            genus,
            created_at,
        };

        observing_db::occurrences::upsert(&self.pool, &params).await?;

        // Sync occurrence_observers
        let co_observers: Vec<String> = record
            .and_then(|r| r.get("recordedBy"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .filter(|did| *did != event.did)
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default();

        observing_db::observers::sync(&self.pool, &event.uri, &event.did, &co_observers).await?;

        Ok(())
    }

    /// Delete an occurrence record
    pub async fn delete_occurrence(&self, uri: &str) -> Result<()> {
        debug!("Deleting occurrence: {}", uri);
        observing_db::occurrences::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Upsert an identification record
    pub async fn upsert_identification(&self, event: &IdentificationEvent) -> Result<()> {
        debug!("Upserting identification: {}", event.uri);

        let record = event.record.as_ref();
        let subject = record.and_then(|r| r.get("subject"));
        let subject_uri = subject.and_then(|s| s.get("uri")).and_then(|v| v.as_str());
        let subject_cid = subject
            .and_then(|s| s.get("cid"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let subject_index = record
            .and_then(|r| r.get("subjectIndex"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
        let taxon_name = record
            .and_then(|r| r.get("taxonName"))
            .and_then(|v| v.as_str());
        let taxon_rank = record
            .and_then(|r| r.get("taxonRank"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let comment = record
            .and_then(|r| r.get("comment"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let is_agreement = record
            .and_then(|r| r.get("isAgreement"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let created_at = record
            .and_then(|r| r.get("createdAt"))
            .and_then(|v| v.as_str());
        let taxon_id = record
            .and_then(|r| r.get("taxonId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let subject_uri = match subject_uri {
            Some(uri) => uri,
            None => {
                warn!(uri = %event.uri, "Skipping identification without subject uri");
                return Ok(());
            }
        };
        let taxon_name = match taxon_name {
            Some(name) => name,
            None => {
                warn!(uri = %event.uri, "Skipping identification without taxonName");
                return Ok(());
            }
        };
        let date_identified = created_at
            .and_then(parse_naive_datetime)
            .unwrap_or_else(|| event.time.naive_utc());

        let params = UpsertIdentificationParams {
            uri: event.uri.clone(),
            cid: event.cid.clone(),
            did: event.did.clone(),
            subject_uri: subject_uri.to_string(),
            subject_cid: subject_cid.to_string(),
            subject_index,
            scientific_name: taxon_name.to_string(),
            taxon_rank,
            taxon_id,
            identification_remarks: comment,
            is_agreement,
            date_identified,
            vernacular_name: None,
            kingdom: None,
            phylum: None,
            class: None,
            order: None,
            family: None,
            genus: None,
            confidence: None,
        };

        observing_db::identifications::upsert(&self.pool, &params).await?;
        Ok(())
    }

    /// Delete an identification record
    pub async fn delete_identification(&self, uri: &str) -> Result<()> {
        debug!("Deleting identification: {}", uri);
        observing_db::identifications::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Upsert a comment record
    pub async fn upsert_comment(&self, event: &CommentEvent) -> Result<()> {
        debug!("Upserting comment: {}", event.uri);

        let record = event.record.as_ref();
        let subject = record.and_then(|r| r.get("subject"));
        let subject_uri = subject.and_then(|s| s.get("uri")).and_then(|v| v.as_str());
        let subject_cid = subject
            .and_then(|s| s.get("cid"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let body = record.and_then(|r| r.get("body")).and_then(|v| v.as_str());
        let reply_to = record.and_then(|r| r.get("replyTo"));
        let reply_to_uri = reply_to
            .and_then(|s| s.get("uri"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let reply_to_cid = reply_to
            .and_then(|s| s.get("cid"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let created_at = record
            .and_then(|r| r.get("createdAt"))
            .and_then(|v| v.as_str());

        let subject_uri = match subject_uri {
            Some(uri) => uri,
            None => {
                warn!(uri = %event.uri, "Skipping comment without subject uri");
                return Ok(());
            }
        };
        let body = match body {
            Some(b) => b,
            None => {
                warn!(uri = %event.uri, "Skipping comment without body");
                return Ok(());
            }
        };
        let created_at = created_at
            .and_then(parse_naive_datetime)
            .unwrap_or_else(|| event.time.naive_utc());

        let params = UpsertCommentParams {
            uri: event.uri.clone(),
            cid: event.cid.clone(),
            did: event.did.clone(),
            subject_uri: subject_uri.to_string(),
            subject_cid: subject_cid.to_string(),
            body: body.to_string(),
            reply_to_uri,
            reply_to_cid,
            created_at,
        };

        observing_db::comments::upsert(&self.pool, &params).await?;
        Ok(())
    }

    /// Delete a comment record
    pub async fn delete_comment(&self, uri: &str) -> Result<()> {
        debug!("Deleting comment: {}", uri);
        observing_db::comments::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Upsert an interaction record
    pub async fn upsert_interaction(&self, event: &InteractionEvent) -> Result<()> {
        debug!("Upserting interaction: {}", event.uri);

        let record = event.record.as_ref();
        let subject_a = record.and_then(|r| r.get("subjectA"));
        let subject_b = record.and_then(|r| r.get("subjectB"));

        // Subject A fields
        let subject_a_occurrence = subject_a.and_then(|s| s.get("occurrence"));
        let subject_a_occurrence_uri = subject_a_occurrence
            .and_then(|o| o.get("uri"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let subject_a_occurrence_cid = subject_a_occurrence
            .and_then(|o| o.get("cid"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let subject_a_subject_index = subject_a
            .and_then(|s| s.get("subjectIndex"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
        let subject_a_taxon_name = subject_a
            .and_then(|s| s.get("taxonName"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let subject_a_kingdom = subject_a
            .and_then(|s| s.get("kingdom"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Subject B fields
        let subject_b_occurrence = subject_b.and_then(|s| s.get("occurrence"));
        let subject_b_occurrence_uri = subject_b_occurrence
            .and_then(|o| o.get("uri"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let subject_b_occurrence_cid = subject_b_occurrence
            .and_then(|o| o.get("cid"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let subject_b_subject_index = subject_b
            .and_then(|s| s.get("subjectIndex"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32;
        let subject_b_taxon_name = subject_b
            .and_then(|s| s.get("taxonName"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let subject_b_kingdom = subject_b
            .and_then(|s| s.get("kingdom"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Interaction details
        let interaction_type = record
            .and_then(|r| r.get("interactionType"))
            .and_then(|v| v.as_str());
        let direction = record
            .and_then(|r| r.get("direction"))
            .and_then(|v| v.as_str())
            .unwrap_or("AtoB");
        let confidence = record
            .and_then(|r| r.get("confidence"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let comment = record
            .and_then(|r| r.get("comment"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let created_at = record
            .and_then(|r| r.get("createdAt"))
            .and_then(|v| v.as_str());

        let interaction_type = match interaction_type {
            Some(t) => t,
            None => {
                warn!(uri = %event.uri, "Skipping interaction without interactionType");
                return Ok(());
            }
        };

        let created_at = created_at.and_then(parse_datetime).unwrap_or(event.time);

        let params = UpsertInteractionParams {
            uri: event.uri.clone(),
            cid: event.cid.clone(),
            did: event.did.clone(),
            subject_a_occurrence_uri,
            subject_a_occurrence_cid,
            subject_a_subject_index,
            subject_a_taxon_name,
            subject_a_kingdom,
            subject_b_occurrence_uri,
            subject_b_occurrence_cid,
            subject_b_subject_index,
            subject_b_taxon_name,
            subject_b_kingdom,
            interaction_type: interaction_type.to_string(),
            direction: direction.to_string(),
            confidence,
            comment,
            created_at,
        };

        observing_db::interactions::upsert(&self.pool, &params).await?;
        Ok(())
    }

    /// Delete an interaction record
    pub async fn delete_interaction(&self, uri: &str) -> Result<()> {
        debug!("Deleting interaction: {}", uri);
        observing_db::interactions::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Upsert a like record
    pub async fn upsert_like(&self, event: &LikeEvent) -> Result<()> {
        debug!("Upserting like: {}", event.uri);

        let record = event.record.as_ref();
        let subject = record.and_then(|r| r.get("subject"));
        let subject_uri = subject.and_then(|s| s.get("uri")).and_then(|v| v.as_str());
        let subject_cid = subject
            .and_then(|s| s.get("cid"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let created_at = record
            .and_then(|r| r.get("createdAt"))
            .and_then(|v| v.as_str());

        let subject_uri = match subject_uri {
            Some(uri) => uri,
            None => {
                warn!(uri = %event.uri, "Skipping like without subject uri");
                return Ok(());
            }
        };
        let created_at = created_at
            .and_then(parse_naive_datetime)
            .unwrap_or_else(|| event.time.naive_utc());

        let params = CreateLikeParams {
            uri: event.uri.clone(),
            cid: event.cid.clone(),
            did: event.did.clone(),
            subject_uri: subject_uri.to_string(),
            subject_cid: subject_cid.to_string(),
            created_at,
        };

        observing_db::likes::create(&self.pool, &params).await?;
        Ok(())
    }

    /// Delete a like record
    pub async fn delete_like(&self, uri: &str) -> Result<()> {
        debug!("Deleting like: {}", uri);
        observing_db::likes::delete(&self.pool, uri).await?;
        Ok(())
    }

    /// Get the saved cursor for resumption
    pub async fn get_cursor(&self) -> Result<Option<i64>> {
        let row = sqlx::query!("SELECT value FROM ingester_state WHERE key = 'cursor'")
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.and_then(|r| r.value.parse::<i64>().ok()))
    }

    /// Save the cursor for resumption
    pub async fn save_cursor(&self, cursor: i64) -> Result<()> {
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
}
