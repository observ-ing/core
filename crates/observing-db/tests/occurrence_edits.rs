//! Regression tests for occurrence edits (#856, found by the ingester sim in
//! #854): an edit that removes a field must clear it in the database.

mod common;

use chrono::Utc;
use observing_db::occurrences;
use observing_db::types::UpsertOccurrenceParams;
use serde_json::{json, Value};

const URI: &str = "at://did:plc:alice/bio.lexicons.temp.v0-1.occurrence/r0";

fn occurrence(
    quantity: Option<&str>,
    external_records: Option<Value>,
    associated_media: Option<Value>,
) -> UpsertOccurrenceParams {
    UpsertOccurrenceParams {
        uri: URI.into(),
        cid: "bafyoccurrence".into(),
        did: "did:plc:alice".into(),
        scientific_name: None,
        event_date_start: None,
        event_date_end: None,
        event_date_raw: None,
        longitude: Some(-122.4194),
        latitude: Some(37.7749),
        coordinate_uncertainty_meters: None,
        organism_quantity: quantity.map(str::to_string),
        organism_quantity_type: quantity.map(|_| "individuals".to_string()),
        associated_media,
        external_records,
        occurrence_remarks_uri: None,
        event_remarks_uri: None,
        recorded_by: None,
        taxon_id: None,
        taxon_rank: None,
        kingdom: None,
        created_at: Utc::now(),
    }
}

#[tokio::test]
async fn edit_clears_removed_quantity_and_external_records() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let inat =
        json!([{ "uri": "https://www.inaturalist.org/observations/1", "service": "inaturalist" }]);
    occurrences::upsert(&db.pool, &occurrence(Some("10-100"), Some(inat), None))
        .await
        .unwrap();
    occurrences::upsert(&db.pool, &occurrence(None, None, None))
        .await
        .unwrap();

    let row: (Option<String>, Option<String>, Option<Value>) = sqlx::query_as(
        "SELECT organism_quantity, organism_quantity_type, external_records \
         FROM occurrences WHERE uri = $1",
    )
    .bind(URI)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(row, (None, None, None), "removed fields must be cleared");
    db.drop().await;
}

#[tokio::test]
async fn edit_without_resolved_media_keeps_existing_media() {
    // Deliberate exception: a transient PDS failure during media resolution
    // yields no media, which must not wipe media already resolved.
    let Some(db) = common::scratch().await else {
        return;
    };
    let media = json!([{ "image": { "ref": { "$link": "bafyblob" } } }]);
    occurrences::upsert(&db.pool, &occurrence(None, None, Some(media.clone())))
        .await
        .unwrap();
    occurrences::upsert(&db.pool, &occurrence(None, None, None))
        .await
        .unwrap();

    let kept: Option<Value> =
        sqlx::query_scalar("SELECT associated_media FROM occurrences WHERE uri = $1")
            .bind(URI)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(kept, Some(media));
    db.drop().await;
}
