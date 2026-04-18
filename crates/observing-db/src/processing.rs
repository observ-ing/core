//! Shared record processing: convert AT Protocol lexicon JSON → database params.
//!
//! This module is gated behind the `processing` feature flag and provides
//! conversion functions used by both the appview (synchronous path) and
//! the ingester (asynchronous firehose path).

use crate::types::{
    BlobEntry, CreateLikeParams, UpsertCommentParams, UpsertIdentificationParams,
    UpsertInteractionParams, UpsertOccurrenceParams,
};
use chrono::{DateTime, NaiveDateTime, Utc};
use observing_lexicons::bio_lexicons::temp::occurrence::Occurrence;
use observing_lexicons::ing_observ::temp::{comment::Comment, interaction::Interaction};
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

/// Result of parsing an occurrence record, containing both the database
/// params and the typed `recorded_by` field for co-observer processing.
pub struct ParsedOccurrence {
    pub params: UpsertOccurrenceParams,
    /// The `recordedBy` DIDs from the lexicon record (if present).
    pub recorded_by: Option<Vec<String>>,
}

/// Convert an occurrence record JSON to database params.
///
/// The `record_json` should be the full AT Protocol record value (a `serde_json::Value`).
/// Fields like `blobs` are extracted from the raw JSON to populate `associated_media`.
///
/// Returns a [`ParsedOccurrence`] containing the upsert params and the typed
/// `recorded_by` list so callers can process co-observers without re-parsing JSON.
pub fn occurrence_from_json(
    record_json: &Value,
    uri: String,
    cid: String,
    did: String,
) -> Result<ParsedOccurrence, ProcessingError> {
    let record_str = record_json.to_string();
    let record: Occurrence =
        serde_json::from_str(&record_str).map_err(ProcessingError::Deserialization)?;

    // Try flat coordinates first (bio.lexicons.temp.occurrence), then fall back
    // to nested location object (legacy ing.observ.temp.occurrence records on PDS).
    let location = record_json.get("location");
    let lat = record
        .decimal_latitude
        .as_deref()
        .or_else(|| {
            location
                .and_then(|l| l.get("decimalLatitude"))
                .and_then(|v| v.as_str())
        })
        .and_then(|s| s.parse::<f64>().ok());
    let lng = record
        .decimal_longitude
        .as_deref()
        .or_else(|| {
            location
                .and_then(|l| l.get("decimalLongitude"))
                .and_then(|v| v.as_str())
        })
        .and_then(|s| s.parse::<f64>().ok());

    let (lat, lng) = match (lat, lng) {
        (Some(lat), Some(lng)) => (lat, lng),
        _ => {
            return Err(ProcessingError::InvalidField(
                "missing valid coordinates".into(),
            ))
        }
    };

    let event_date = record
        .event_date
        .as_ref()
        .and_then(|d| parse_datetime(&d.to_string()))
        .or_else(|| {
            // Fallback: read eventDate from raw JSON (legacy records)
            record_json
                .get("eventDate")
                .and_then(|v| v.as_str())
                .and_then(parse_datetime)
        })
        .ok_or_else(|| ProcessingError::InvalidField("missing valid eventDate".into()))?;

    // Extension fields: read from raw JSON (not part of bio.lexicons.temp.occurrence schema)
    let created_at = record_json
        .get("createdAt")
        .and_then(|v| v.as_str())
        .and_then(parse_datetime)
        .unwrap_or(event_date);

    let recorded_by: Option<Vec<String>> = record_json
        .get("recordedBy")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(Into::into))
                .collect()
        });

    Ok(ParsedOccurrence {
        params: UpsertOccurrenceParams {
            uri,
            cid,
            did,
            scientific_name: None,
            event_date,
            longitude: lng,
            latitude: lat,
            coordinate_uncertainty_meters: record
                .coordinate_uncertainty_in_meters
                .or_else(|| {
                    location
                        .and_then(|l| l.get("coordinateUncertaintyInMeters"))
                        .and_then(|v| v.as_i64())
                })
                .map(|v| v as i32),
            // Try legacy "blobs" field first (inline image embeds), then skip
            // "associatedMedia" (strong refs that require media record resolution).
            // The appview write path provides blob entries directly via parsed.params.
            associated_media: record_json.get("blobs").and_then(|v| {
                let blobs: Vec<BlobEntry> = serde_json::from_value(v.clone()).ok()?;
                if blobs.is_empty() {
                    None
                } else {
                    Some(v.clone())
                }
            }),
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
        },
        recorded_by,
    })
}

/// Convert an identification record JSON to database params.
///
/// Expects the flat `bio.lexicons.temp.identification` format.
///
/// `fallback_time` is used when `createdAt` cannot be parsed from the record
/// (typically the firehose event time).
pub fn identification_from_json(
    record_json: &Value,
    uri: String,
    cid: String,
    did: String,
    fallback_time: DateTime<Utc>,
) -> Result<UpsertIdentificationParams, ProcessingError> {
    let scientific_name = record_json
        .get("scientificName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ProcessingError::InvalidField("missing scientificName".into()))?
        .to_string();

    let occurrence = record_json
        .get("occurrence")
        .ok_or_else(|| ProcessingError::InvalidField("missing occurrence reference".into()))?;
    let subject_uri = occurrence
        .get("uri")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ProcessingError::InvalidField("missing occurrence uri".into()))?
        .to_string();
    let subject_cid = occurrence
        .get("cid")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ProcessingError::InvalidField("missing occurrence cid".into()))?
        .to_string();

    let taxon_rank = record_json
        .get("taxonRank")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let kingdom = record_json
        .get("kingdom")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let is_agreement = record_json
        .get("isAgreement")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let taxon_id = record_json
        .get("taxonId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let date_identified = record_json
        .get("createdAt")
        .and_then(|v| v.as_str())
        .and_then(parse_naive_datetime)
        .unwrap_or_else(|| fallback_time.naive_utc());

    Ok(UpsertIdentificationParams {
        uri,
        cid,
        did,
        subject_uri,
        subject_cid,
        scientific_name,
        taxon_rank,
        taxon_id,
        is_agreement,
        date_identified,
        vernacular_name: None,
        kingdom,
        phylum: None,
        class: None,
        order: None,
        family: None,
        genus: None,
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
    let record: Comment =
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
    let record: Interaction =
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
        subject_a_taxon_name: record
            .subject_a
            .taxon
            .as_ref()
            .map(|t| t.scientific_name.to_string()),
        subject_a_kingdom: record
            .subject_a
            .taxon
            .as_ref()
            .and_then(|t| t.kingdom.as_ref().map(|s| s.to_string())),
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
        subject_b_taxon_name: record
            .subject_b
            .taxon
            .as_ref()
            .map(|t| t.scientific_name.to_string()),
        subject_b_kingdom: record
            .subject_b
            .taxon
            .as_ref()
            .and_then(|t| t.kingdom.as_ref().map(|s| s.to_string())),
        interaction_type: record.interaction_type.as_ref().to_string(),
        direction: record.direction.to_string(),
        comment: record.comment.map(|s| s.to_string()),
        created_at,
    })
}

/// Convert a like record JSON to database params.
pub fn like_from_json(
    record_json: &Value,
    uri: String,
    cid: String,
    did: String,
    fallback_time: DateTime<Utc>,
) -> Result<CreateLikeParams, ProcessingError> {
    let record_str = record_json.to_string();
    let record: observing_lexicons::ing_observ::temp::like::Like =
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

/// Extract co-observer DIDs from a typed `recorded_by` list,
/// filtering out the primary author.
pub fn extract_co_observers<T: AsRef<str>>(
    recorded_by: Option<&[T]>,
    author_did: &str,
) -> Vec<String> {
    recorded_by
        .map(|arr| {
            arr.iter()
                .map(AsRef::as_ref)
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
    use jacquard_lexicon::schema::LexiconSchema;
    use observing_lexicons::bio_lexicons::temp::identification::Identification;
    use observing_lexicons::ing_observ::temp::like::Like;

    /// Asserts the JSON fixture is a structurally valid record under its
    /// declared lexicon: it deserializes into the typed lexicon struct *and*
    /// satisfies the schema's runtime constraint checks (maxLength, enum
    /// values, required fields, etc.). This proves a fixture is something a
    /// real PDS could produce — not just JSON that happens to flow through a
    /// `*_from_json` parser. Every happy-path test below validates its
    /// fixture this way before exercising the parser, so any drift between
    /// the test fixtures and the lexicon definitions surfaces immediately.
    fn assert_valid_lexicon<T>(record: &serde_json::Value)
    where
        T: serde::de::DeserializeOwned + LexiconSchema,
    {
        let typed: T = serde_json::from_value(record.clone())
            .unwrap_or_else(|e| panic!("fixture failed to deserialize as {}: {e}", T::nsid()));
        typed.validate().unwrap_or_else(|e| {
            panic!("fixture violated {} lexicon constraints: {e:?}", T::nsid())
        });
    }

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
        let recorded_by = vec![
            "did:plc:author".to_string(),
            "did:plc:coobs1".to_string(),
            "did:plc:coobs2".to_string(),
        ];
        let result = extract_co_observers(Some(recorded_by.as_slice()), "did:plc:author");
        assert_eq!(result, vec!["did:plc:coobs1", "did:plc:coobs2"]);
    }

    #[test]
    fn test_extract_co_observers_none() {
        let result: Vec<String> = extract_co_observers(None::<&[String]>, "did:plc:author");
        assert!(result.is_empty());
    }

    #[test]
    fn test_extract_co_observers_empty() {
        let recorded_by: Vec<String> = vec![];
        let result = extract_co_observers(Some(recorded_by.as_slice()), "did:plc:author");
        assert!(result.is_empty());
    }

    /// Baseline happy-path coverage for `identification_from_json`. Locks in
    /// the current field mapping so future divergence between the appview
    /// write path and the ingester surfaces here.
    #[test]
    fn test_identification_from_json_happy_path() {
        let record = serde_json::json!({
            "$type": "bio.lexicons.temp.identification",
            "scientificName": "Quercus alba",
            "taxonRank": "species",
            "kingdom": "Plantae",
            "taxonId": "gbif:2879737",
            "isAgreement": true,
            "occurrence": {
                "uri": "at://did:plc:author/bio.lexicons.temp.occurrence/abc",
                "cid": "bafyreioccurrence"
            },
            "createdAt": "2024-06-15T08:30:45Z"
        });

        assert_valid_lexicon::<Identification>(&record);

        let fallback = DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let params = identification_from_json(
            &record,
            "at://did:plc:identifier/bio.lexicons.temp.identification/xyz".to_string(),
            "bafyreiident".to_string(),
            "did:plc:identifier".to_string(),
            fallback,
        )
        .expect("record should parse");

        assert_eq!(params.scientific_name, "Quercus alba");
        assert_eq!(params.taxon_rank.as_deref(), Some("species"));
        assert_eq!(params.kingdom.as_deref(), Some("Plantae"));
        assert_eq!(params.taxon_id.as_deref(), Some("gbif:2879737"));
        assert!(params.is_agreement);
        assert_eq!(
            params.subject_uri,
            "at://did:plc:author/bio.lexicons.temp.occurrence/abc"
        );
        assert_eq!(params.subject_cid, "bafyreioccurrence");
        // createdAt is parsed via parse_naive_datetime, so it lands as UTC naive.
        assert_eq!(params.date_identified.date().to_string(), "2024-06-15");
    }

    /// `identification_from_json` falls back to the supplied time when the
    /// record's `createdAt` is missing or unparseable. Pins the fallback
    /// behavior so the ingester (which passes the firehose event time) and
    /// the appview (which would pass `Utc::now()`) stay aligned.
    #[test]
    fn test_identification_from_json_uses_fallback_time() {
        let record = serde_json::json!({
            "$type": "bio.lexicons.temp.identification",
            "scientificName": "Quercus alba",
            "occurrence": {
                "uri": "at://did:plc:author/bio.lexicons.temp.occurrence/abc",
                "cid": "bafyreioccurrence"
            }
            // no createdAt
        });

        assert_valid_lexicon::<Identification>(&record);

        let fallback = DateTime::parse_from_rfc3339("2024-03-20T15:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let params = identification_from_json(
            &record,
            "uri".into(),
            "cid".into(),
            "did:plc:x".into(),
            fallback,
        )
        .expect("record should parse without createdAt");

        assert_eq!(params.date_identified, fallback.naive_utc());
    }

    /// Baseline happy-path coverage for `comment_from_json`.
    #[test]
    fn test_comment_from_json_happy_path() {
        let record = serde_json::json!({
            "$type": "ing.observ.temp.comment",
            "subject": {
                "uri": "at://did:plc:author/bio.lexicons.temp.occurrence/abc",
                "cid": "bafyreioccurrence"
            },
            "body": "Nice find — looks like a juvenile.",
            "createdAt": "2024-06-15T08:30:45Z"
        });

        assert_valid_lexicon::<Comment>(&record);

        let fallback = DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let params = comment_from_json(
            &record,
            "at://did:plc:commenter/ing.observ.temp.comment/xyz".to_string(),
            "bafyreicomment".to_string(),
            "did:plc:commenter".to_string(),
            fallback,
        )
        .expect("record should parse");

        assert_eq!(params.body, "Nice find — looks like a juvenile.");
        assert_eq!(
            params.subject_uri,
            "at://did:plc:author/bio.lexicons.temp.occurrence/abc"
        );
        assert_eq!(params.subject_cid, "bafyreioccurrence");
        assert!(params.reply_to_uri.is_none());
        assert!(params.reply_to_cid.is_none());
    }

    /// `comment_from_json` carries `replyTo` strong refs through to the
    /// `reply_to_uri` / `reply_to_cid` columns. This is the only place
    /// threaded discussion state is reconstructed in the DB.
    #[test]
    fn test_comment_from_json_threaded_reply() {
        let record = serde_json::json!({
            "$type": "ing.observ.temp.comment",
            "subject": {
                "uri": "at://did:plc:author/bio.lexicons.temp.occurrence/abc",
                "cid": "bafyreioccurrence"
            },
            "replyTo": {
                "uri": "at://did:plc:other/ing.observ.temp.comment/parent",
                "cid": "bafyreiparentcomment"
            },
            "body": "Agreed!",
            "createdAt": "2024-06-15T08:35:00Z"
        });

        assert_valid_lexicon::<Comment>(&record);

        let fallback = DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let params = comment_from_json(
            &record,
            "uri".into(),
            "cid".into(),
            "did:plc:replier".into(),
            fallback,
        )
        .expect("record should parse");

        assert_eq!(
            params.reply_to_uri.as_deref(),
            Some("at://did:plc:other/ing.observ.temp.comment/parent")
        );
        assert_eq!(params.reply_to_cid.as_deref(), Some("bafyreiparentcomment"));
    }

    /// Baseline happy-path coverage for `interaction_from_json`. Covers the
    /// "both subjects reference an occurrence" shape — the only path the
    /// interaction lexicon supports without taxon-only references.
    #[test]
    fn test_interaction_from_json_happy_path_both_occurrences() {
        let record = serde_json::json!({
            "$type": "ing.observ.temp.interaction",
            "subjectA": {
                "occurrence": {
                    "uri": "at://did:plc:author/bio.lexicons.temp.occurrence/predator",
                    "cid": "bafyreipred"
                }
            },
            "subjectB": {
                "occurrence": {
                    "uri": "at://did:plc:author/bio.lexicons.temp.occurrence/prey",
                    "cid": "bafyreiprey"
                }
            },
            "interactionType": "predation",
            "direction": "AtoB",
            "comment": "Caught mid-strike.",
            "createdAt": "2024-06-15T08:30:45Z"
        });

        assert_valid_lexicon::<Interaction>(&record);

        let fallback = DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let params = interaction_from_json(
            &record,
            "at://did:plc:observer/ing.observ.temp.interaction/xyz".to_string(),
            "bafyreiinter".to_string(),
            "did:plc:observer".to_string(),
            fallback,
        )
        .expect("record should parse");

        assert_eq!(params.interaction_type, "predation");
        assert_eq!(params.direction, "AtoB");
        assert_eq!(params.comment.as_deref(), Some("Caught mid-strike."));
        assert_eq!(
            params.subject_a_occurrence_uri.as_deref(),
            Some("at://did:plc:author/bio.lexicons.temp.occurrence/predator")
        );
        assert_eq!(
            params.subject_b_occurrence_uri.as_deref(),
            Some("at://did:plc:author/bio.lexicons.temp.occurrence/prey")
        );
        // No taxon references on either side
        assert!(params.subject_a_taxon_name.is_none());
        assert!(params.subject_b_taxon_name.is_none());
    }

    /// `interaction_from_json` should pull taxon scientific names through
    /// when subjects use the taxon-only shape (no concrete occurrence).
    #[test]
    fn test_interaction_from_json_taxon_only_subject() {
        let record = serde_json::json!({
            "$type": "ing.observ.temp.interaction",
            "subjectA": {
                "occurrence": {
                    "uri": "at://did:plc:author/bio.lexicons.temp.occurrence/bee",
                    "cid": "bafyreibee"
                }
            },
            "subjectB": {
                "taxon": {
                    "scientificName": "Trifolium repens",
                    "kingdom": "Plantae"
                }
            },
            "interactionType": "pollination",
            "direction": "AtoB",
            "createdAt": "2024-06-15T08:30:45Z"
        });

        assert_valid_lexicon::<Interaction>(&record);

        let fallback = DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let params = interaction_from_json(
            &record,
            "uri".into(),
            "cid".into(),
            "did:plc:observer".into(),
            fallback,
        )
        .expect("record should parse");

        assert_eq!(
            params.subject_b_taxon_name.as_deref(),
            Some("Trifolium repens")
        );
        assert_eq!(params.subject_b_kingdom.as_deref(), Some("Plantae"));
        assert!(params.subject_b_occurrence_uri.is_none());
    }

    /// Baseline happy-path coverage for `like_from_json`.
    #[test]
    fn test_like_from_json_happy_path() {
        let record = serde_json::json!({
            "$type": "ing.observ.temp.like",
            "subject": {
                "uri": "at://did:plc:author/bio.lexicons.temp.occurrence/abc",
                "cid": "bafyreioccurrence"
            },
            "createdAt": "2024-06-15T08:30:45Z"
        });

        assert_valid_lexicon::<Like>(&record);

        let fallback = DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let params = like_from_json(
            &record,
            "at://did:plc:liker/ing.observ.temp.like/xyz".to_string(),
            "bafyreilike".to_string(),
            "did:plc:liker".to_string(),
            fallback,
        )
        .expect("record should parse");

        assert_eq!(
            params.subject_uri,
            "at://did:plc:author/bio.lexicons.temp.occurrence/abc"
        );
        assert_eq!(params.subject_cid, "bafyreioccurrence");
        assert_eq!(params.did, "did:plc:liker");
        assert_eq!(params.created_at.date().to_string(), "2024-06-15");
    }

    /// `occurrence_from_json` is the single conversion both the appview and
    /// the ingester use to turn a PDS occurrence record into a DB row. The
    /// appview's create path writes occurrences in the
    /// `bio.lexicons.temp.occurrence` shape, where images are referenced via
    /// `associatedMedia` strong refs to separate `bio.lexicons.temp.media`
    /// records — there is no inline `blobs` field on the occurrence itself.
    ///
    /// Today this conversion only reads the legacy inline `blobs` field and
    /// silently drops `associatedMedia`, so any record produced by the
    /// current write path ends up with `associated_media = None`. This works
    /// only because the appview also writes the DB row directly with the
    /// in-memory blob entries — if anything other than that direct write
    /// becomes the populating path (ingester-only writes, backfill, etc.),
    /// new observations land with no images.
    ///
    /// Marked `#[ignore]` because the bug is not yet fixed; running with
    /// `cargo test -- --ignored` reproduces the failure. Remove the attribute
    /// once the ingester learns to resolve `associatedMedia` → media records
    /// → blob entries.
    #[test]
    #[ignore = "ingester does not yet resolve associatedMedia strong refs; see test docs"]
    fn test_occurrence_from_json_resolves_associated_media() {
        let record = serde_json::json!({
            "$type": "bio.lexicons.temp.occurrence",
            "decimalLatitude": "37.7749",
            "decimalLongitude": "-122.4194",
            "coordinateUncertaintyInMeters": 10,
            "eventDate": "2024-06-15T08:30:45.123Z",
            "associatedMedia": [
                {
                    "uri": "at://did:plc:author/bio.lexicons.temp.media/abc123",
                    "cid": "bafyreiabc123"
                },
                {
                    "uri": "at://did:plc:author/bio.lexicons.temp.media/def456",
                    "cid": "bafyreidef456"
                }
            ]
        });

        // Pin down that the fixture really is a valid bio.lexicons.temp.occurrence
        // — the regression is "we lose photos on a structurally valid record",
        // not "we mishandle malformed input".
        assert_valid_lexicon::<Occurrence>(&record);

        let parsed = occurrence_from_json(
            &record,
            "at://did:plc:author/bio.lexicons.temp.occurrence/xyz".to_string(),
            "bafyreioccurrence".to_string(),
            "did:plc:author".to_string(),
        )
        .expect("record should parse");

        assert!(
            parsed.params.associated_media.is_some(),
            "occurrence_from_json must populate associated_media when the \
             record carries associatedMedia strong refs; without this, \
             ingester-only writes lose every photo on new observations"
        );
    }
}
