//! Conversions from QuickSlice GraphQL types to observing-db row types.
//!
//! This allows the existing enrichment pipeline to work unchanged
//! while the data source migrates from direct SQL to QuickSlice GraphQL.

use chrono::{DateTime, Utc};
use observing_db::types::{CommentRow, IdentificationRow, OccurrenceRow};
use quickslice_client::types as qs;

fn parse_datetime(s: Option<&str>) -> DateTime<Utc> {
    s.and_then(|s| s.parse::<DateTime<Utc>>().ok())
        .unwrap_or_else(Utc::now)
}

pub fn occurrence_from_qs(o: qs::Occurrence) -> OccurrenceRow {
    let loc = o.location.as_ref();
    let lat: f64 = loc
        .and_then(|l| l.decimal_latitude.as_deref())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);
    let lng: f64 = loc
        .and_then(|l| l.decimal_longitude.as_deref())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);

    // Convert blobs to associated_media JSON (matches observing-db's BlobEntry format)
    let associated_media = o.blobs.as_ref().map(|blobs| {
        serde_json::Value::Array(
            blobs
                .iter()
                .filter_map(|b| {
                    // Reconstruct the blob entry in the format OccurrenceRow.blob_entries() expects
                    let image_val = b.image.as_ref()?;
                    let mut entry = serde_json::Map::new();
                    entry.insert("image".to_string(), image_val.clone());
                    if let Some(alt) = &b.alt {
                        entry.insert("alt".to_string(), serde_json::Value::String(alt.clone()));
                    }
                    Some(serde_json::Value::Object(entry))
                })
                .collect(),
        )
    });

    OccurrenceRow {
        uri: o.uri,
        cid: o.cid,
        did: o.did,
        scientific_name: None, // Not on the occurrence lexicon; comes from identifications
        event_date: parse_datetime(o.event_date.as_deref()),
        latitude: lat,
        longitude: lng,
        coordinate_uncertainty_meters: loc.and_then(|l| l.coordinate_uncertainty_in_meters),
        continent: loc.and_then(|l| l.continent.clone()),
        country: loc.and_then(|l| l.country.clone()),
        country_code: loc.and_then(|l| l.country_code.clone()),
        state_province: loc.and_then(|l| l.state_province.clone()),
        county: loc.and_then(|l| l.county.clone()),
        municipality: loc.and_then(|l| l.municipality.clone()),
        locality: loc.and_then(|l| l.locality.clone()),
        water_body: loc.and_then(|l| l.water_body.clone()),
        verbatim_locality: o.verbatim_locality,
        occurrence_remarks: o.notes,
        associated_media,
        recorded_by: o
            .recorded_by
            .map(|dids| serde_json::to_string(&dids).unwrap_or_default()),
        taxon_id: None,
        taxon_rank: None,
        vernacular_name: None,
        kingdom: None,
        phylum: None,
        class: None,
        order_: None,
        family: None,
        genus: None,
        created_at: parse_datetime(o.created_at.as_deref()),
        distance_meters: None,
        source: None,
        observer_role: None,
    }
}

pub fn identification_from_qs(id: qs::Identification) -> IdentificationRow {
    let taxon = id.taxon.as_ref();
    IdentificationRow {
        uri: id.uri,
        cid: id.cid,
        did: id.did,
        subject_uri: String::new(), // Not directly available; comes from join context
        subject_cid: String::new(),
        subject_index: id.subject_index.unwrap_or(0),
        scientific_name: taxon
            .and_then(|t| t.scientific_name.clone())
            .unwrap_or_default(),
        taxon_rank: taxon.and_then(|t| t.taxon_rank.clone()),
        identification_qualifier: None,
        taxon_id: id.taxon_id,
        identification_remarks: id.comment,
        identification_verification_status: None,
        type_status: None,
        is_agreement: id.is_agreement,
        date_identified: parse_datetime(id.created_at.as_deref()),
        vernacular_name: taxon.and_then(|t| t.vernacular_name.clone()),
        kingdom: taxon.and_then(|t| t.kingdom.clone()),
        phylum: taxon.and_then(|t| t.phylum.clone()),
        class: taxon.and_then(|t| t.class.clone()),
        order_: taxon.and_then(|t| t.order.clone()),
        family: taxon.and_then(|t| t.family.clone()),
        genus: taxon.and_then(|t| t.genus.clone()),
    }
}

pub fn comment_from_qs(c: qs::Comment) -> CommentRow {
    CommentRow {
        uri: c.uri,
        cid: c.cid,
        did: c.did,
        subject_uri: String::new(), // From join context
        subject_cid: String::new(),
        body: c.body.unwrap_or_default(),
        reply_to_uri: None,
        reply_to_cid: None,
        created_at: parse_datetime(c.created_at.as_deref()),
    }
}
