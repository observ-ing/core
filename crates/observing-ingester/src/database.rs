//! Database layer for the Observ.ing ingester
//!
//! Deserializes raw firehose JSON events into typed records using
//! `observing-lexicons` and delegates to the shared `observing-db` crate for SQL execution.

use crate::error::Result;
use crate::types::{
    CommentEvent, IdentificationEvent, InteractionEvent, LikeEvent, OccurrenceEvent,
};
use chrono::{DateTime, NaiveDateTime, Utc};
use observing_db::types::{
    CreateLikeParams, UpsertCommentParams, UpsertIdentificationParams, UpsertInteractionParams,
    UpsertOccurrenceParams,
};
use observing_lexicons::org_rwell::test::{
    comment::Comment, identification::Identification, interaction::Interaction,
    occurrence::Occurrence,
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

        let record_json = match &event.record {
            Some(v) => v,
            None => {
                warn!(uri = %event.uri, "Skipping occurrence without record");
                return Ok(());
            }
        };

        let record_str = record_json.to_string();
        let record: Occurrence<'_> = match serde_json::from_str(&record_str) {
            Ok(r) => r,
            Err(e) => {
                warn!(uri = %event.uri, error = %e, "Failed to deserialize occurrence record");
                return Ok(());
            }
        };

        let lat = record
            .location
            .decimal_latitude
            .as_ref()
            .parse::<f64>()
            .ok();
        let lng = record
            .location
            .decimal_longitude
            .as_ref()
            .parse::<f64>()
            .ok();

        let (lat, lng) = match (lat, lng) {
            (Some(lat), Some(lng)) => (lat, lng),
            _ => {
                warn!(uri = %event.uri, "Skipping occurrence without valid coordinates");
                return Ok(());
            }
        };

        let event_date = match parse_datetime(&record.event_date.to_string()) {
            Some(d) => d,
            None => {
                warn!(uri = %event.uri, "Skipping occurrence without valid eventDate");
                return Ok(());
            }
        };

        let created_at = parse_datetime(&record.created_at.to_string()).unwrap_or(event_date);

        let params = UpsertOccurrenceParams {
            uri: event.uri.clone(),
            cid: event.cid.clone(),
            did: event.did.clone(),
            scientific_name: record.scientific_name.map(|s| s.to_string()),
            event_date,
            longitude: lng,
            latitude: lat,
            coordinate_uncertainty_meters: record
                .location
                .coordinate_uncertainty_in_meters
                .map(|v| v as i32),
            continent: record.location.continent.map(|s| s.to_string()),
            country: record.location.country.map(|s| s.to_string()),
            country_code: record.location.country_code.map(|s| s.to_string()),
            state_province: record.location.state_province.map(|s| s.to_string()),
            county: record.location.county.map(|s| s.to_string()),
            municipality: record.location.municipality.map(|s| s.to_string()),
            locality: record.location.locality.map(|s| s.to_string()),
            water_body: record.location.water_body.map(|s| s.to_string()),
            verbatim_locality: record.verbatim_locality.map(|s| s.to_string()),
            occurrence_remarks: record.notes.map(|s| s.to_string()),
            associated_media: record_json.get("blobs").cloned(),
            recorded_by: None,
            taxon_id: record.taxon_id.map(|s| s.to_string()),
            taxon_rank: record.taxon_rank.map(|s| s.to_string()),
            vernacular_name: record.vernacular_name.map(|s| s.to_string()),
            kingdom: record.kingdom.map(|s| s.to_string()),
            phylum: record.phylum.map(|s| s.to_string()),
            class: record.class.map(|s| s.to_string()),
            order: record.order.map(|s| s.to_string()),
            family: record.family.map(|s| s.to_string()),
            genus: record.genus.map(|s| s.to_string()),
            created_at,
        };

        observing_db::occurrences::upsert(&self.pool, &params).await?;

        // Sync occurrence_observers
        let co_observers: Vec<String> = record
            .recorded_by
            .unwrap_or_default()
            .iter()
            .filter(|did| did.as_ref() != event.did)
            .map(|s| s.to_string())
            .collect();

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

        let record_json = match &event.record {
            Some(v) => v,
            None => {
                warn!(uri = %event.uri, "Skipping identification without record");
                return Ok(());
            }
        };

        let record_str = record_json.to_string();
        let record: Identification<'_> = match serde_json::from_str(&record_str) {
            Ok(r) => r,
            Err(e) => {
                warn!(uri = %event.uri, error = %e, "Failed to deserialize identification record");
                return Ok(());
            }
        };

        let date_identified = parse_naive_datetime(&record.created_at.to_string())
            .unwrap_or_else(|| event.time.naive_utc());

        let params = UpsertIdentificationParams {
            uri: event.uri.clone(),
            cid: event.cid.clone(),
            did: event.did.clone(),
            subject_uri: record.subject.uri.to_string(),
            subject_cid: record.subject.cid.to_string(),
            subject_index: record.subject_index.unwrap_or(0) as i32,
            scientific_name: record.taxon_name.to_string(),
            taxon_rank: record.taxon_rank.map(|s| s.to_string()),
            taxon_id: record.taxon_id.map(|s| s.to_string()),
            identification_remarks: record.comment.map(|s| s.to_string()),
            is_agreement: record.is_agreement.unwrap_or(false),
            date_identified,
            vernacular_name: record.vernacular_name.map(|s| s.to_string()),
            kingdom: record.kingdom.map(|s| s.to_string()),
            phylum: record.phylum.map(|s| s.to_string()),
            class: record.class.map(|s| s.to_string()),
            order: record.order.map(|s| s.to_string()),
            family: record.family.map(|s| s.to_string()),
            genus: record.genus.map(|s| s.to_string()),
            confidence: record.confidence.map(|s| s.to_string()),
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

        let record_json = match &event.record {
            Some(v) => v,
            None => {
                warn!(uri = %event.uri, "Skipping comment without record");
                return Ok(());
            }
        };

        let record_str = record_json.to_string();
        let record: Comment<'_> = match serde_json::from_str(&record_str) {
            Ok(r) => r,
            Err(e) => {
                warn!(uri = %event.uri, error = %e, "Failed to deserialize comment record");
                return Ok(());
            }
        };

        let created_at = parse_naive_datetime(&record.created_at.to_string())
            .unwrap_or_else(|| event.time.naive_utc());

        let params = UpsertCommentParams {
            uri: event.uri.clone(),
            cid: event.cid.clone(),
            did: event.did.clone(),
            subject_uri: record.subject.uri.to_string(),
            subject_cid: record.subject.cid.to_string(),
            body: record.body.to_string(),
            reply_to_uri: record.reply_to.as_ref().map(|r| r.uri.to_string()),
            reply_to_cid: record.reply_to.as_ref().map(|r| r.cid.to_string()),
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

        let record_json = match &event.record {
            Some(v) => v,
            None => {
                warn!(uri = %event.uri, "Skipping interaction without record");
                return Ok(());
            }
        };

        let record_str = record_json.to_string();
        let record: Interaction<'_> = match serde_json::from_str(&record_str) {
            Ok(r) => r,
            Err(e) => {
                warn!(uri = %event.uri, error = %e, "Failed to deserialize interaction record");
                return Ok(());
            }
        };

        let interaction_type = record.interaction_type.as_ref();
        let direction = record.direction.to_string();
        let created_at = parse_datetime(&record.created_at.to_string()).unwrap_or(event.time);

        let params = UpsertInteractionParams {
            uri: event.uri.clone(),
            cid: event.cid.clone(),
            did: event.did.clone(),
            subject_a_occurrence_uri: record
                .subject_a
                .occurrence
                .as_ref()
                .map(|o| o.uri.to_string()),
            subject_a_occurrence_cid: record
                .subject_a
                .occurrence
                .as_ref()
                .map(|o| o.cid.to_string()),
            subject_a_subject_index: record.subject_a.subject_index.unwrap_or(0) as i32,
            subject_a_taxon_name: record.subject_a.taxon_name.as_ref().map(|s| s.to_string()),
            subject_a_kingdom: record.subject_a.kingdom.as_ref().map(|s| s.to_string()),
            subject_b_occurrence_uri: record
                .subject_b
                .occurrence
                .as_ref()
                .map(|o| o.uri.to_string()),
            subject_b_occurrence_cid: record
                .subject_b
                .occurrence
                .as_ref()
                .map(|o| o.cid.to_string()),
            subject_b_subject_index: record.subject_b.subject_index.unwrap_or(0) as i32,
            subject_b_taxon_name: record.subject_b.taxon_name.as_ref().map(|s| s.to_string()),
            subject_b_kingdom: record.subject_b.kingdom.as_ref().map(|s| s.to_string()),
            interaction_type: interaction_type.to_string(),
            direction,
            confidence: record.confidence.map(|s| s.to_string()),
            comment: record.comment.map(|s| s.to_string()),
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

        let record_json = match &event.record {
            Some(v) => v,
            None => {
                warn!(uri = %event.uri, "Skipping like without record");
                return Ok(());
            }
        };

        // Likes can be app.bsky.feed.like or org.rwell.test.like — both have the same
        // shape (subject + createdAt). Use the org.rwell.test.like type.
        let record_str = record_json.to_string();
        let record: observing_lexicons::org_rwell::test::like::Like<'_> =
            match serde_json::from_str(&record_str) {
                Ok(r) => r,
                Err(e) => {
                    warn!(uri = %event.uri, error = %e, "Failed to deserialize like record");
                    return Ok(());
                }
            };

        let created_at = parse_naive_datetime(&record.created_at.to_string())
            .unwrap_or_else(|| event.time.naive_utc());

        let params = CreateLikeParams {
            uri: event.uri.clone(),
            cid: event.cid.clone(),
            did: event.did.clone(),
            subject_uri: record.subject.uri.to_string(),
            subject_cid: record.subject.cid.to_string(),
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
    use super::*;
    use chrono::{Datelike, Timelike};

    #[test]
    fn test_parse_datetime_utc() {
        let dt = parse_datetime("2024-01-15T12:00:00Z").unwrap();
        assert_eq!(dt.year(), 2024);
        assert_eq!(dt.month(), 1);
        assert_eq!(dt.day(), 15);
        assert_eq!(dt.hour(), 12);
    }

    #[test]
    fn test_parse_datetime_with_offset() {
        let dt = parse_datetime("2024-01-15T12:00:00+05:00").unwrap();
        assert_eq!(dt.hour(), 7);
    }

    #[test]
    fn test_parse_datetime_with_millis() {
        let dt = parse_datetime("2024-06-15T08:30:45.123Z").unwrap();
        assert_eq!(dt.year(), 2024);
        assert_eq!(dt.minute(), 30);
    }

    #[test]
    fn test_parse_datetime_invalid() {
        assert!(parse_datetime("").is_none());
        assert!(parse_datetime("not a date").is_none());
        assert!(parse_datetime("2024-01-15").is_none());
    }

    #[test]
    fn test_parse_naive_datetime_utc() {
        let dt = parse_naive_datetime("2024-01-15T12:00:00Z").unwrap();
        assert_eq!(dt.year(), 2024);
        assert_eq!(dt.hour(), 12);
    }

    #[test]
    fn test_parse_naive_datetime_converts_to_utc() {
        let dt = parse_naive_datetime("2024-01-15T12:00:00+05:00").unwrap();
        assert_eq!(dt.hour(), 7);
    }

    #[test]
    fn test_parse_naive_datetime_invalid() {
        assert!(parse_naive_datetime("").is_none());
        assert!(parse_naive_datetime("garbage").is_none());
    }
}
