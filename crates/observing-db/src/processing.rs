//! Shared record processing: convert AT Protocol lexicon JSON → database params.
//!
//! This module is gated behind the `processing` feature flag and provides
//! conversion functions used by both the appview (synchronous path) and
//! the ingester (asynchronous firehose path).

use crate::types::{
    CreateLikeParams, UpsertCommentParams, UpsertIdentificationParams, UpsertInteractionParams,
    UpsertOccurrenceParams,
};
use chrono::{DateTime, NaiveDateTime, Utc};
use observing_lexicons::org_rwell::test::{
    comment::Comment, identification::Identification, interaction::Interaction,
    occurrence::Occurrence,
};
use serde_json::Value;

/// Errors that can occur during record processing
#[derive(Debug)]
pub enum ProcessingError {
    /// JSON could not be deserialized into the expected lexicon type
    Deserialization(serde_json::Error),
    /// Required field is missing or invalid
    InvalidField(String),
}

impl std::fmt::Display for ProcessingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Deserialization(e) => write!(f, "deserialization error: {e}"),
            Self::InvalidField(msg) => write!(f, "invalid field: {msg}"),
        }
    }
}

impl std::error::Error for ProcessingError {}

/// Parse an ISO 8601 date string into a DateTime<Utc>
pub fn parse_datetime(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
}

/// Parse an ISO 8601 date string into a NaiveDateTime
pub fn parse_naive_datetime(s: &str) -> Option<NaiveDateTime> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.naive_utc())
        .ok()
}

/// Convert an occurrence record JSON to database params.
///
/// The `record_json` should be the full AT Protocol record value (a `serde_json::Value`).
/// Fields like `blobs` are extracted from the raw JSON to populate `associated_media`.
pub fn occurrence_from_json(
    record_json: &Value,
    uri: String,
    cid: String,
    did: String,
) -> Result<UpsertOccurrenceParams, ProcessingError> {
    let record_str = record_json.to_string();
    let record: Occurrence<'_> =
        serde_json::from_str(&record_str).map_err(ProcessingError::Deserialization)?;

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
            return Err(ProcessingError::InvalidField(
                "missing valid coordinates".into(),
            ))
        }
    };

    let event_date = parse_datetime(&record.event_date.to_string())
        .ok_or_else(|| ProcessingError::InvalidField("missing valid eventDate".into()))?;

    let created_at = parse_datetime(&record.created_at.to_string()).unwrap_or(event_date);

    Ok(UpsertOccurrenceParams {
        uri,
        cid,
        did,
        scientific_name: None,
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
        taxon_id: None,
        taxon_rank: None,
        vernacular_name: None,
        kingdom: None,
        phylum: None,
        class: None,
        order: None,
        family: None,
        genus: None,
        created_at,
    })
}

/// Convert an identification record JSON to database params.
///
/// `fallback_time` is used when `created_at` cannot be parsed from the record
/// (typically the firehose event time).
pub fn identification_from_json(
    record_json: &Value,
    uri: String,
    cid: String,
    did: String,
    fallback_time: DateTime<Utc>,
) -> Result<UpsertIdentificationParams, ProcessingError> {
    let record_str = record_json.to_string();
    let record: Identification<'_> =
        serde_json::from_str(&record_str).map_err(ProcessingError::Deserialization)?;

    let date_identified = parse_naive_datetime(&record.created_at.to_string())
        .unwrap_or_else(|| fallback_time.naive_utc());

    Ok(UpsertIdentificationParams {
        uri,
        cid,
        did,
        subject_uri: record.subject.uri.to_string(),
        subject_cid: record.subject.cid.to_string(),
        subject_index: record.subject_index.unwrap_or(0) as i32,
        scientific_name: record.taxon.scientific_name.to_string(),
        taxon_rank: record.taxon.taxon_rank.map(|s| s.to_string()),
        taxon_id: record.taxon_id.map(|s| s.to_string()),
        identification_remarks: record.comment.map(|s| s.to_string()),
        is_agreement: record.is_agreement.unwrap_or(false),
        date_identified,
        vernacular_name: record.taxon.vernacular_name.map(|s| s.to_string()),
        kingdom: record.taxon.kingdom.map(|s| s.to_string()),
        phylum: record.taxon.phylum.map(|s| s.to_string()),
        class: record.taxon.class.map(|s| s.to_string()),
        order: record.taxon.order.map(|s| s.to_string()),
        family: record.taxon.family.map(|s| s.to_string()),
        genus: record.taxon.genus.map(|s| s.to_string()),
        confidence: record.confidence.map(|s| s.to_string()),
    })
}

/// Convert a comment record JSON to database params.
pub fn comment_from_json(
    record_json: &Value,
    uri: String,
    cid: String,
    did: String,
    fallback_time: DateTime<Utc>,
) -> Result<UpsertCommentParams, ProcessingError> {
    let record_str = record_json.to_string();
    let record: Comment<'_> =
        serde_json::from_str(&record_str).map_err(ProcessingError::Deserialization)?;

    let created_at = parse_naive_datetime(&record.created_at.to_string())
        .unwrap_or_else(|| fallback_time.naive_utc());

    Ok(UpsertCommentParams {
        uri,
        cid,
        did,
        subject_uri: record.subject.uri.to_string(),
        subject_cid: record.subject.cid.to_string(),
        body: record.body.to_string(),
        reply_to_uri: record.reply_to.as_ref().map(|r| r.uri.to_string()),
        reply_to_cid: record.reply_to.as_ref().map(|r| r.cid.to_string()),
        created_at,
    })
}

/// Convert an interaction record JSON to database params.
pub fn interaction_from_json(
    record_json: &Value,
    uri: String,
    cid: String,
    did: String,
    fallback_time: DateTime<Utc>,
) -> Result<UpsertInteractionParams, ProcessingError> {
    let record_str = record_json.to_string();
    let record: Interaction<'_> =
        serde_json::from_str(&record_str).map_err(ProcessingError::Deserialization)?;

    let created_at = parse_datetime(&record.created_at.to_string()).unwrap_or(fallback_time);

    Ok(UpsertInteractionParams {
        uri,
        cid,
        did,
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
        subject_a_taxon_name: record.subject_a.taxon.as_ref().map(|t| t.scientific_name.to_string()),
        subject_a_kingdom: record.subject_a.taxon.as_ref().and_then(|t| t.kingdom.as_ref().map(|s| s.to_string())),
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
        subject_b_taxon_name: record.subject_b.taxon.as_ref().map(|t| t.scientific_name.to_string()),
        subject_b_kingdom: record.subject_b.taxon.as_ref().and_then(|t| t.kingdom.as_ref().map(|s| s.to_string())),
        interaction_type: record.interaction_type.as_ref().to_string(),
        direction: record.direction.to_string(),
        confidence: record.confidence.map(|s| s.to_string()),
        comment: record.comment.map(|s| s.to_string()),
        created_at,
    })
}

/// Convert a like record JSON to database params.
///
/// Handles both `app.bsky.feed.like` and `org.rwell.test.like` (same shape).
pub fn like_from_json(
    record_json: &Value,
    uri: String,
    cid: String,
    did: String,
    fallback_time: DateTime<Utc>,
) -> Result<CreateLikeParams, ProcessingError> {
    let record_str = record_json.to_string();
    let record: observing_lexicons::org_rwell::test::like::Like<'_> =
        serde_json::from_str(&record_str).map_err(ProcessingError::Deserialization)?;

    let created_at = parse_naive_datetime(&record.created_at.to_string())
        .unwrap_or_else(|| fallback_time.naive_utc());

    Ok(CreateLikeParams {
        uri,
        cid,
        did,
        subject_uri: record.subject.uri.to_string(),
        subject_cid: record.subject.cid.to_string(),
        created_at,
    })
}

/// Extract co-observer DIDs from an occurrence record JSON,
/// filtering out the primary author.
pub fn extract_co_observers(record_json: &Value, author_did: &str) -> Vec<String> {
    record_json
        .get("recordedBy")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .filter(|did| *did != author_did)
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default()
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

    #[test]
    fn test_extract_co_observers() {
        let json = serde_json::json!({
            "recordedBy": ["did:plc:author", "did:plc:coobs1", "did:plc:coobs2"]
        });
        let result = extract_co_observers(&json, "did:plc:author");
        assert_eq!(result, vec!["did:plc:coobs1", "did:plc:coobs2"]);
    }

    #[test]
    fn test_extract_co_observers_empty() {
        let json = serde_json::json!({});
        let result = extract_co_observers(&json, "did:plc:author");
        assert!(result.is_empty());
    }
}
