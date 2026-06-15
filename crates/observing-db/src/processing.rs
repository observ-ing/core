//! Shared record processing: convert AT Protocol lexicon JSON → database params.
//!
//! This module is gated behind the `processing` feature flag and provides
//! conversion functions used by both the appview (synchronous path) and
//! the ingester (asynchronous firehose path).

use crate::types::{
    BlobEntry, CreateLikeParams, UpsertCommentParams, UpsertIdentificationParams,
    UpsertInteractionParams, UpsertOccurrenceParams,
};
use chrono::{DateTime, Datelike, NaiveDateTime, TimeZone, Utc};
use observing_lexicons::bio_lexicons::temp::v0_1::occurrence::Occurrence;
use observing_lexicons::ing_observ::temp::{
    comment::Comment,
    interaction::{Interaction, InteractionSubject},
};
use serde::Deserialize;
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

/// A Darwin Core `eventDate` value normalized to the half-open `[start, end)`
/// UTC interval it denotes. A single value expands to the implicit interval of
/// its stated precision (`1971` → `[1971-01-01, 1972-01-01)`); an explicit
/// interval spans from the start of its first component to the end of its last.
///
/// `start` is what feeds sort by; `[start, end)` is what date filters overlap
/// against (see PR #2). The raw string is kept separately for display fidelity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EventDateBounds {
    /// Earliest instant the value could refer to (inclusive).
    pub start: DateTime<Utc>,
    /// Latest instant the value could refer to (exclusive).
    pub end: DateTime<Utc>,
}

/// Expand a Darwin Core `eventDate` string into a half-open `[start, end)` UTC
/// interval, or `None` if it is not a recognized date / date-time / interval.
///
/// Accepts the value space the `bio.lexicons.temp.v0-1.occurrence` lexicon
/// documents: ISO 8601-1 single dates (`1971`, `1906-06`, `1963-03-08`),
/// date-times (`1963-03-08T14:07:00-06:00`), and ISO 8601-2 intervals whose
/// start and end are separated by a solidus (`1995-05-21/1995-05-23`). Reduced
/// precision is treated as the implicit interval it denotes. This is a
/// deliberate subset of EDTF: uncertainty flags (`?`/`~`/`%`) and unspecified
/// digits (`196X`) are rejected rather than guessed at. A naive date-time with
/// no offset is read as UTC.
pub fn expand_event_date(s: &str) -> Option<EventDateBounds> {
    let s = s.trim();
    match s.split_once('/') {
        // Interval: span from the start of the first component to the end of
        // the last. `expand_component` returns each side's own `[start, end)`.
        Some((from, to)) => {
            let (start, _) = expand_component(from.trim())?;
            let (_, end) = expand_component(to.trim())?;
            (start < end).then_some(EventDateBounds { start, end })
        }
        None => {
            let (start, end) = expand_component(s)?;
            Some(EventDateBounds { start, end })
        }
    }
}

/// Expand a single (non-interval) date value to the `[start, end)` interval of
/// its stated precision.
fn expand_component(s: &str) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    use chrono::{Duration, NaiveDate};

    // Full date-time: `1963-03-08T14:07:00-06:00` (or trailing `Z`). A second
    // of precision is the smallest unit we distinguish here.
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        let start = dt.with_timezone(&Utc);
        return Some((start, start + Duration::seconds(1)));
    }
    // Date-time without an offset: read as UTC (lenient — the lexicon asks for
    // an offset, but legacy/hand-entered values may omit it).
    if let Ok(ndt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        let start = ndt.and_utc();
        return Some((start, start + Duration::seconds(1)));
    }
    // Date: `1963-03-08`.
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        let start = d.and_hms_opt(0, 0, 0)?.and_utc();
        return Some((start, start + Duration::days(1)));
    }
    // Year-month: `1906-06`. parse_from_str would accept a missing day, so
    // require the exact `YYYY-MM` shape before treating it as month precision.
    if s.len() == 7 && s.as_bytes()[4] == b'-' {
        if let Ok(d) = NaiveDate::parse_from_str(&format!("{s}-01"), "%Y-%m-%d") {
            let start = d.and_hms_opt(0, 0, 0)?.and_utc();
            return Some((start, first_of_next_month(d.year(), d.month())?));
        }
    }
    // Year: `1971`.
    if s.len() == 4 && s.bytes().all(|b| b.is_ascii_digit()) {
        let year: i32 = s.parse().ok()?;
        let start = Utc.with_ymd_and_hms(year, 1, 1, 0, 0, 0).single()?;
        let end = Utc.with_ymd_and_hms(year + 1, 1, 1, 0, 0, 0).single()?;
        return Some((start, end));
    }
    None
}

/// First instant of the month after `year-month`, in UTC.
fn first_of_next_month(year: i32, month: u32) -> Option<DateTime<Utc>> {
    let (y, m) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    Utc.with_ymd_and_hms(y, m, 1, 0, 0, 0).single()
}

/// A strong reference to a `bio.lexicons.temp.v0-1.media` record, as it appears
/// in an occurrence's `media` array (legacy: `associatedMedia`). Callers (the
/// ingester) resolve these by fetching the referenced record from the author's
/// PDS to build `BlobEntry` values for `associated_media`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssociatedMediaRef {
    pub uri: String,
    pub cid: String,
}

/// Result of parsing an occurrence record.
pub struct ParsedOccurrence {
    pub params: UpsertOccurrenceParams,
    /// Strong refs to `bio.lexicons.temp.v0-1.media` records. The ingester resolves
    /// these asynchronously to populate `params.associated_media`; the appview
    /// write path ignores this field because it already has the blobs in-memory.
    pub associated_media_refs: Vec<AssociatedMediaRef>,
}

/// Convert an occurrence record JSON to database params.
///
/// The `record_json` should be the full AT Protocol record value (a `serde_json::Value`).
/// Fields like `blobs` are extracted from the raw JSON to populate `associated_media`.
///
/// `fallback_time` is used for `created_at` when the record's `createdAt` is
/// missing or unparseable — typically the firehose commit time, which closely
/// tracks when the record was authored on the PDS. Using event_date as the
/// fallback would conflate post time with observation time and make backdated
/// observations sort to the wrong place in feeds.
///
pub fn occurrence_from_json(
    record_json: &Value,
    uri: String,
    cid: String,
    did: String,
    fallback_time: DateTime<Utc>,
) -> Result<ParsedOccurrence, ProcessingError> {
    let record_str = record_json.to_string();
    let record: Occurrence =
        serde_json::from_str(&record_str).map_err(ProcessingError::Deserialization)?;

    // Try flat coordinates first (bio.lexicons.temp.v0-1.occurrence), then fall back
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

    // Both coordinates must be present together to mean anything; mixing
    // one with NULL would silently misplace the point at the equator or
    // prime meridian.
    let coords = match (lat, lng) {
        (Some(lat), Some(lng)) => Some((lat, lng)),
        _ => None,
    };

    // The raw eventDate string is the source of truth for display and for
    // round-tripping ranges / reduced precision (e.g. "1971" or
    // "1995-05-21/1995-05-23"); `event_date` below is a sortable instant
    // derived from it. Fall back to the raw JSON key for legacy records.
    let event_date_raw = record
        .event_date
        .as_ref()
        .map(|d| d.to_string())
        .or_else(|| {
            record_json
                .get("eventDate")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .filter(|s| !s.trim().is_empty());

    // Sortable instant: the start of the interval the eventDate denotes.
    // NULL when the value is absent or not a recognized date/interval — the
    // raw string is still preserved for display.
    let event_date = event_date_raw
        .as_deref()
        .and_then(expand_event_date)
        .map(|b| b.start);

    // Extension fields: read from raw JSON (not part of bio.lexicons.temp.v0-1.occurrence schema)
    let created_at = record_json
        .get("createdAt")
        .and_then(|v| v.as_str())
        .and_then(parse_datetime)
        .unwrap_or(fallback_time);

    // The lexicon renamed `associatedMedia` → `media`; read the current key,
    // falling back to the legacy one for already-published records.
    let associated_media_refs: Vec<AssociatedMediaRef> = record_json
        .get("media")
        .or_else(|| record_json.get("associatedMedia"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    let uri = v.get("uri").and_then(|u| u.as_str())?.to_string();
                    let cid = v.get("cid").and_then(|c| c.as_str())?.to_string();
                    Some(AssociatedMediaRef { uri, cid })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(ParsedOccurrence {
        params: UpsertOccurrenceParams {
            uri,
            cid,
            did,
            scientific_name: None,
            event_date,
            event_date_raw,
            longitude: coords.map(|(_, lng)| lng),
            latitude: coords.map(|(lat, _)| lat),
            coordinate_uncertainty_meters: record
                .coordinate_uncertainty_in_meters
                .or_else(|| {
                    location
                        .and_then(|l| l.get("coordinateUncertaintyInMeters"))
                        .and_then(|v| v.as_i64())
                })
                .map(|v| v as i32),
            organism_quantity: record.organism_quantity.map(|q| q.to_string()),
            organism_quantity_type: record
                .organism_quantity_type
                .as_ref()
                .map(|t| t.as_str().to_string()),
            // Try legacy "blobs" field first (inline image embeds), then skip
            // "media" (strong refs that require media record resolution).
            // The appview write path provides blob entries directly via parsed.params.
            associated_media: record_json.get("blobs").and_then(|v| {
                // Borrow-deserialize to validate shape without cloning the Value.
                let blobs = Vec::<BlobEntry>::deserialize(v).ok()?;
                if blobs.is_empty() {
                    None
                } else {
                    Some(v.clone())
                }
            }),
            recorded_by: None,
            taxon_id: None,
            taxon_rank: None,
            kingdom: None,
            created_at,
        },
        associated_media_refs,
    })
}

/// Convert an identification record JSON to database params.
///
/// Expects the flat `bio.lexicons.temp.v0-1.identification` format.
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

    // Darwin Core canonical casing is `taxonID` (uppercase ID); camelCasing it
    // would silently drop the field. See the identification lexicon on lexicons.bio.
    let taxon_id = record_json
        .get("taxonID")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let date_identified = record_json
        .get("createdAt")
        .and_then(|v| v.as_str())
        .and_then(parse_naive_datetime)
        .map(|nd| chrono::TimeZone::from_utc_datetime(&Utc, &nd))
        .unwrap_or(fallback_time);

    Ok(UpsertIdentificationParams {
        uri,
        cid,
        did,
        subject_uri,
        subject_cid,
        scientific_name,
        taxon_rank,
        taxon_id,
        date_identified,
        kingdom,
        // Resolved by the taxonomy resolver before upsert; the JSON record
        // carries no consensus taxon information.
        accepted_taxon_key: None,
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
        .map(|nd| chrono::TimeZone::from_utc_datetime(&Utc, &nd))
        .unwrap_or(fallback_time);

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

/// The occurrence/taxon fields extracted from one side of an interaction.
/// Both `subject_a` and `subject_b` flatten into the same four columns, so
/// the extraction lives in one place to keep the two sides from drifting.
struct SubjectFields {
    occurrence_uri: Option<String>,
    occurrence_cid: Option<String>,
    taxon_name: Option<String>,
    kingdom: Option<String>,
}

fn extract_subject_fields(subject: &InteractionSubject) -> SubjectFields {
    SubjectFields {
        occurrence_uri: subject.occurrence.as_ref().map(|o| o.uri.to_string()),
        occurrence_cid: subject.occurrence.as_ref().map(|o| o.cid.to_string()),
        taxon_name: subject
            .taxon
            .as_ref()
            .map(|t| t.scientific_name.to_string()),
        kingdom: subject
            .taxon
            .as_ref()
            .and_then(|t| t.kingdom.as_ref().map(|s| s.to_string())),
    }
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

    let subject_a = extract_subject_fields(&record.subject_a);
    let subject_b = extract_subject_fields(&record.subject_b);

    Ok(UpsertInteractionParams {
        uri,
        cid,
        did,
        subject_a_occurrence_uri: subject_a.occurrence_uri,
        subject_a_occurrence_cid: subject_a.occurrence_cid,
        subject_a_taxon_name: subject_a.taxon_name,
        subject_a_kingdom: subject_a.kingdom,
        subject_b_occurrence_uri: subject_b.occurrence_uri,
        subject_b_occurrence_cid: subject_b.occurrence_cid,
        subject_b_taxon_name: subject_b.taxon_name,
        subject_b_kingdom: subject_b.kingdom,
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Datelike, Timelike};
    use jacquard_lexicon::schema::LexiconSchema;
    use observing_lexicons::bio_lexicons::temp::v0_1::identification::Identification;
    use observing_lexicons::ing_observ::temp::like::Like;

    fn ts(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn expand_event_date_covers_lexicon_examples() {
        // Single date.
        let b = expand_event_date("1963-03-08").unwrap();
        assert_eq!(b.start, ts("1963-03-08T00:00:00Z"));
        assert_eq!(b.end, ts("1963-03-09T00:00:00Z"));

        // Year only.
        let b = expand_event_date("1971").unwrap();
        assert_eq!(b.start, ts("1971-01-01T00:00:00Z"));
        assert_eq!(b.end, ts("1972-01-01T00:00:00Z"));

        // Year-month (December exercises the year rollover).
        let b = expand_event_date("1906-06").unwrap();
        assert_eq!(b.start, ts("1906-06-01T00:00:00Z"));
        assert_eq!(b.end, ts("1906-07-01T00:00:00Z"));
        assert_eq!(
            expand_event_date("1906-12").unwrap().end,
            ts("1907-01-01T00:00:00Z")
        );

        // Full date-time with offset, normalized to UTC.
        let b = expand_event_date("1963-03-08T14:07:00-06:00").unwrap();
        assert_eq!(b.start, ts("1963-03-08T20:07:00Z"));
        assert_eq!(b.end, ts("1963-03-08T20:07:01Z"));

        // Interval: start of the first day through end of the last day.
        let b = expand_event_date("1995-05-21/1995-05-23").unwrap();
        assert_eq!(b.start, ts("1995-05-21T00:00:00Z"));
        assert_eq!(b.end, ts("1995-05-24T00:00:00Z"));
    }

    #[test]
    fn expand_event_date_mixed_precision_interval() {
        // Reduced-precision bounds expand to their own day/month/year extents.
        let b = expand_event_date("1995-05/1996").unwrap();
        assert_eq!(b.start, ts("1995-05-01T00:00:00Z"));
        assert_eq!(b.end, ts("1997-01-01T00:00:00Z"));
    }

    #[test]
    fn expand_event_date_rejects_unparseable() {
        assert!(expand_event_date("").is_none());
        assert!(expand_event_date("not a date").is_none());
        assert!(expand_event_date("196X").is_none()); // EDTF unspecified digit
        assert!(expand_event_date("1984?").is_none()); // EDTF uncertainty flag
        assert!(expand_event_date("1995-13").is_none()); // invalid month
        assert!(expand_event_date("2000/1999").is_none()); // inverted interval
    }

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
        T: for<'de> serde::Deserialize<'de> + LexiconSchema,
    {
        let typed: T = T::deserialize(record)
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

    /// Baseline happy-path coverage for `identification_from_json`. Locks in
    /// the current field mapping so future divergence between the appview
    /// write path and the ingester surfaces here.
    #[test]
    fn test_identification_from_json_happy_path() {
        let record = serde_json::json!({
            "$type": "bio.lexicons.temp.v0-1.identification",
            "scientificName": "Quercus alba",
            "taxonRank": "species",
            "kingdom": "Plantae",
            "taxonID": "https://www.gbif.org/species/2879737",
            "occurrence": {
                "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/abc",
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
            "at://did:plc:identifier/bio.lexicons.temp.v0-1.identification/xyz".to_string(),
            "bafyreiident".to_string(),
            "did:plc:identifier".to_string(),
            fallback,
        )
        .expect("record should parse");

        assert_eq!(params.scientific_name, "Quercus alba");
        assert_eq!(params.taxon_rank.as_deref(), Some("species"));
        assert_eq!(params.kingdom.as_deref(), Some("Plantae"));
        assert_eq!(
            params.taxon_id.as_deref(),
            Some("https://www.gbif.org/species/2879737")
        );
        assert_eq!(
            params.subject_uri,
            "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/abc"
        );
        assert_eq!(params.subject_cid, "bafyreioccurrence");
        // createdAt is parsed via parse_naive_datetime, then lifted to DateTime<Utc>.
        assert_eq!(
            params.date_identified.date_naive().to_string(),
            "2024-06-15"
        );
    }

    /// `identification_from_json` falls back to the supplied time when the
    /// record's `createdAt` is missing or unparseable. Pins the fallback
    /// behavior so the ingester (which passes the firehose event time) and
    /// the appview (which would pass `Utc::now()`) stay aligned.
    #[test]
    fn test_identification_from_json_uses_fallback_time() {
        let record = serde_json::json!({
            "$type": "bio.lexicons.temp.v0-1.identification",
            "scientificName": "Quercus alba",
            "occurrence": {
                "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/abc",
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

        assert_eq!(params.date_identified, fallback);
    }

    /// Regression guard: `taxonID` is the canonical Darwin Core casing
    /// (uppercase ID) per the bio.lexicons.temp.v0-1.identification schema on
    /// lexicons.bio. A prior bug read the camelCased `taxonId`, silently
    /// dropping inbound values — including the iNaturalist URLs produced by
    /// the import script. This test pins both halves:
    ///   - `taxonID` (canonical) → extracted into `params.taxon_id`
    ///   - `taxonId` (wrong case) → not silently picked up
    #[test]
    fn test_identification_from_json_extracts_canonical_taxon_id_casing() {
        // Half 1: canonical casing with an iNaturalist URL flows through.
        let canonical = serde_json::json!({
            "$type": "bio.lexicons.temp.v0-1.identification",
            "scientificName": "Danaus plexippus",
            "taxonID": "https://www.inaturalist.org/taxa/48662",
            "occurrence": {
                "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/abc",
                "cid": "bafyreioccurrence"
            },
            "createdAt": "2024-06-15T08:30:45Z"
        });

        // Validates against the typed lexicon struct + runtime schema
        // constraints, so any future schema drift on `taxonID` (renamed,
        // re-cased, removed) surfaces here before the parser assertion.
        assert_valid_lexicon::<Identification>(&canonical);

        let fallback = DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let params = identification_from_json(
            &canonical,
            "uri".into(),
            "cid".into(),
            "did:plc:x".into(),
            fallback,
        )
        .expect("record with canonical taxonID should parse");
        assert_eq!(
            params.taxon_id.as_deref(),
            Some("https://www.inaturalist.org/taxa/48662"),
            "canonical taxonID (Darwin Core casing) must flow through to params.taxon_id"
        );

        // Half 2: camelCased `taxonId` must not be silently accepted. If a
        // future refactor re-introduces the wrong casing in the parser, this
        // assertion fails and forces a decision rather than a silent drop.
        let wrong_case = serde_json::json!({
            "$type": "bio.lexicons.temp.v0-1.identification",
            "scientificName": "Danaus plexippus",
            "taxonId": "https://www.inaturalist.org/taxa/48662",
            "occurrence": {
                "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/abc",
                "cid": "bafyreioccurrence"
            }
        });

        let params = identification_from_json(
            &wrong_case,
            "uri".into(),
            "cid".into(),
            "did:plc:x".into(),
            fallback,
        )
        .expect("record without taxonID is still structurally valid");
        assert!(
            params.taxon_id.is_none(),
            "wrong-cased `taxonId` must not be picked up by the parser"
        );
    }

    /// Baseline happy-path coverage for `comment_from_json`.
    #[test]
    fn test_comment_from_json_happy_path() {
        let record = serde_json::json!({
            "$type": "ing.observ.temp.comment",
            "subject": {
                "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/abc",
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
            "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/abc"
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
                "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/abc",
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
                    "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/predator",
                    "cid": "bafyreipred"
                }
            },
            "subjectB": {
                "occurrence": {
                    "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/prey",
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
            Some("at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/predator")
        );
        assert_eq!(
            params.subject_b_occurrence_uri.as_deref(),
            Some("at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/prey")
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
                    "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/bee",
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
                "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/abc",
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
            "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/abc"
        );
        assert_eq!(params.subject_cid, "bafyreioccurrence");
        assert_eq!(params.did, "did:plc:liker");
        assert_eq!(params.created_at.date().to_string(), "2024-06-15");
    }

    /// `occurrence_from_json` is the single conversion both the appview and
    /// the ingester use to turn a PDS occurrence record into a DB row. The
    /// appview's create path writes occurrences in the
    /// `bio.lexicons.temp.v0-1.occurrence` shape, where images are referenced via
    /// `media` strong refs to separate `bio.lexicons.temp.v0-1.media`
    /// records — there is no inline `blobs` field on the occurrence itself.
    ///
    /// Resolving those strong refs requires HTTP calls to the author's PDS,
    /// which the synchronous `observing-db` layer intentionally does not do;
    /// the ingester fetches and converts them in a follow-up step. This test
    /// covers the first half of that pipeline: the parser must surface the
    /// strong refs so the ingester has something to resolve.
    #[test]
    fn test_occurrence_from_json_extracts_media_refs() {
        let record = serde_json::json!({
            "$type": "bio.lexicons.temp.v0-1.occurrence",
            "decimalLatitude": "37.7749",
            "decimalLongitude": "-122.4194",
            "coordinateUncertaintyInMeters": 10,
            "eventDate": "2024-06-15T08:30:45.123Z",
            "media": [
                {
                    "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.media/abc123",
                    "cid": "bafyreiabc123"
                },
                {
                    "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.media/def456",
                    "cid": "bafyreidef456"
                }
            ]
        });

        // Pin down that the fixture really is a valid bio.lexicons.temp.v0-1.occurrence
        // — the regression is "we lose photos on a structurally valid record",
        // not "we mishandle malformed input".
        assert_valid_lexicon::<Occurrence>(&record);

        let parsed = occurrence_from_json(
            &record,
            "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/xyz".to_string(),
            "bafyreioccurrence".to_string(),
            "did:plc:author".to_string(),
            Utc::now(),
        )
        .expect("record should parse");

        assert_eq!(
            parsed.associated_media_refs,
            vec![
                AssociatedMediaRef {
                    uri: "at://did:plc:author/bio.lexicons.temp.v0-1.media/abc123".into(),
                    cid: "bafyreiabc123".into(),
                },
                AssociatedMediaRef {
                    uri: "at://did:plc:author/bio.lexicons.temp.v0-1.media/def456".into(),
                    cid: "bafyreidef456".into(),
                },
            ],
            "occurrence_from_json must surface media strong refs so the \
             ingester can resolve them; without this, ingester-only writes lose \
             every photo on new observations"
        );
        assert!(
            parsed.params.associated_media.is_none(),
            "synchronous parser should not populate associated_media from strong \
             refs — that is the ingester's async job"
        );
    }

    /// Records published before the `associatedMedia` → `media` lexicon rename
    /// still carry the legacy key; the parser must keep resolving their photos.
    #[test]
    fn test_occurrence_from_json_falls_back_to_legacy_associated_media() {
        let record = serde_json::json!({
            "$type": "bio.lexicons.temp.v0-1.occurrence",
            "decimalLatitude": "37.7749",
            "decimalLongitude": "-122.4194",
            "eventDate": "2024-06-15T08:30:45.123Z",
            "associatedMedia": [
                {
                    "uri": "at://did:plc:author/bio.lexicons.temp.v0-1.media/abc123",
                    "cid": "bafyreiabc123"
                }
            ]
        });

        let parsed = occurrence_from_json(
            &record,
            "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/xyz".to_string(),
            "bafyreioccurrence".to_string(),
            "did:plc:author".to_string(),
            Utc::now(),
        )
        .expect("record should parse");

        assert_eq!(
            parsed.associated_media_refs,
            vec![AssociatedMediaRef {
                uri: "at://did:plc:author/bio.lexicons.temp.v0-1.media/abc123".into(),
                cid: "bafyreiabc123".into(),
            }],
            "legacy associatedMedia strong refs must still resolve after the rename"
        );
    }

    /// `occurrence_from_json` falls back to the supplied time for `created_at`
    /// when the record's `createdAt` is missing. The ingester passes the
    /// firehose commit time, which is the right signal for feed ordering —
    /// using `event_date` instead would sort backdated observations (e.g. an
    /// observation taken last month but posted today) to the wrong place.
    #[test]
    fn test_occurrence_from_json_uses_fallback_time_for_created_at() {
        let record = serde_json::json!({
            "$type": "bio.lexicons.temp.v0-1.occurrence",
            "decimalLatitude": "37.7749",
            "decimalLongitude": "-122.4194",
            "coordinateUncertaintyInMeters": 10,
            "eventDate": "2024-06-15T08:30:45Z"
            // no createdAt
        });

        assert_valid_lexicon::<Occurrence>(&record);

        let fallback = DateTime::parse_from_rfc3339("2026-04-26T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let parsed = occurrence_from_json(
            &record,
            "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/xyz".into(),
            "bafyreioccurrence".into(),
            "did:plc:author".into(),
            fallback,
        )
        .expect("record should parse without createdAt");

        assert_eq!(
            parsed.params.created_at, fallback,
            "missing createdAt must fall back to the firehose commit time, \
             not event_date — otherwise feeds sort by observation date"
        );
    }

    /// Survey-based occurrences carry no inline coordinates or eventDate —
    /// those live on the linked bio.lexicons.temp.v0-1.survey record. The
    /// occurrence lexicon marks those fields optional, so the parser must
    /// accept the record and let the database persist NULLs instead of
    /// rejecting it (which previously caused identifications to FK-violate).
    #[test]
    fn test_occurrence_from_json_accepts_survey_based_record() {
        let record = serde_json::json!({
            "$type": "bio.lexicons.temp.v0-1.occurrence",
            "eventID": "at://did:plc:author/bio.lexicons.temp.v0-1.survey/3xyz",
            "taxonID": "https://www.inaturalist.org/taxa/63962",
            "organismQuantity": "1",
            "organismQuantityType": "individual-count"
            // no decimalLatitude/decimalLongitude/eventDate
        });

        let parsed = occurrence_from_json(
            &record,
            "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/xyz".into(),
            "bafyreioccurrence".into(),
            "did:plc:author".into(),
            Utc::now(),
        )
        .expect("survey-based occurrence must parse with NULL location/event_date");

        assert!(parsed.params.latitude.is_none());
        assert!(parsed.params.longitude.is_none());
        assert!(parsed.params.event_date.is_none());
    }

    /// `organismQuantity` / `organismQuantityType` are surfaced from the
    /// lexicon into the upsert params. The quantity is free text; the type is
    /// normalized through the lexicon's open vocabulary (known values keep
    /// their canonical spelling, anything else round-trips verbatim).
    #[test]
    fn test_occurrence_from_json_extracts_organism_quantity() {
        let record = serde_json::json!({
            "$type": "bio.lexicons.temp.v0-1.occurrence",
            "decimalLatitude": "37.7749",
            "decimalLongitude": "-122.4194",
            "eventDate": "2024-06-15T08:30:45Z",
            "organismQuantity": "10-100",
            "organismQuantityType": "individuals"
        });

        assert_valid_lexicon::<Occurrence>(&record);

        let parsed = occurrence_from_json(
            &record,
            "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/xyz".into(),
            "bafyreioccurrence".into(),
            "did:plc:author".into(),
            Utc::now(),
        )
        .expect("record should parse");

        assert_eq!(parsed.params.organism_quantity.as_deref(), Some("10-100"));
        assert_eq!(
            parsed.params.organism_quantity_type.as_deref(),
            Some("individuals")
        );
    }

    /// Records without the quantity fields leave both params as NULL.
    #[test]
    fn test_occurrence_from_json_omits_absent_organism_quantity() {
        let record = serde_json::json!({
            "$type": "bio.lexicons.temp.v0-1.occurrence",
            "decimalLatitude": "37.7749",
            "decimalLongitude": "-122.4194",
            "eventDate": "2024-06-15T08:30:45Z"
        });

        let parsed = occurrence_from_json(
            &record,
            "at://did:plc:author/bio.lexicons.temp.v0-1.occurrence/xyz".into(),
            "bafyreioccurrence".into(),
            "did:plc:author".into(),
            Utc::now(),
        )
        .expect("record should parse");

        assert!(parsed.params.organism_quantity.is_none());
        assert!(parsed.params.organism_quantity_type.is_none());
    }
}
