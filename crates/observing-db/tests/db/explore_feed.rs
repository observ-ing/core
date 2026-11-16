//! The explore feed's `observer` filter limits results to one user's
//! occurrences, on its own and combined with the other filters and the
//! keyset cursor.

use crate::common;

use chrono::{DateTime, Duration, TimeZone, Utc};
use observing_db::types::{ExploreFeedOptions, OccurrenceRow, UpsertOccurrenceParams};
use observing_db::{feeds, occurrences};

const ALICE: &str = "did:plc:alice";
const BOB: &str = "did:plc:bob";

fn occurrence(did: &str, n: i64, scientific_name: &str) -> UpsertOccurrenceParams {
    UpsertOccurrenceParams {
        uri: format!("at://{did}/bio.lexicons.temp.v0-1.occurrence/r{n}"),
        cid: "bafyoccurrence".into(),
        did: did.into(),
        scientific_name: Some(scientific_name.into()),
        event_date_start: None,
        event_date_end: None,
        event_date_raw: None,
        longitude: None,
        latitude: None,
        coordinate_uncertainty_meters: None,
        organism_quantity: None,
        organism_quantity_type: None,
        associated_media: None,
        external_records: None,
        occurrence_remarks_uri: None,
        event_remarks_uri: None,
        recorded_by: None,
        taxon_id: None,
        taxon_rank: None,
        kingdom: Some("Plantae".into()),
        created_at: Utc::now() - Duration::minutes(n),
    }
}

fn on_day(mut params: UpsertOccurrenceParams, day: DateTime<Utc>) -> UpsertOccurrenceParams {
    params.event_date_raw = Some(day.format("%Y-%m-%d").to_string());
    params.event_date_start = Some(day);
    params.event_date_end = Some(day + Duration::days(1));
    params
}

fn with_media(mut params: UpsertOccurrenceParams) -> UpsertOccurrenceParams {
    params.associated_media = Some(serde_json::json!([{ "image": "bafyblob" }]));
    params
}

fn uris(rows: &[OccurrenceRow]) -> Vec<&str> {
    rows.iter().map(|o| o.uri.as_str()).collect()
}

fn observer(did: &str) -> ExploreFeedOptions {
    ExploreFeedOptions {
        observer: Some(did.into()),
        ..Default::default()
    }
}

#[tokio::test]
async fn explore_feed_filters_by_observer() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let jan = Utc.with_ymd_and_hms(2026, 1, 15, 0, 0, 0).unwrap();
    let jun = Utc.with_ymd_and_hms(2026, 6, 15, 0, 0, 0).unwrap();
    let rows = [
        with_media(on_day(occurrence(ALICE, 0, "Acer rubrum"), jan)),
        on_day(occurrence(ALICE, 1, "Acer saccharum"), jun),
        with_media(on_day(occurrence(ALICE, 2, "Quercus alba"), jan)),
        with_media(on_day(occurrence(ALICE, 3, "Acer negundo"), jan)),
        with_media(on_day(occurrence(BOB, 4, "Acer rubrum"), jan)),
    ];
    for row in &rows {
        occurrences::upsert(&db.pool, row).await.unwrap();
    }
    let uri = |i: usize| rows[i].uri.as_str();

    // Alone: only alice's occurrences, newest first.
    let feed = feeds::get_explore_feed(&db.pool, &observer(ALICE), &[])
        .await
        .unwrap();
    assert_eq!(uris(&feed), [uri(0), uri(1), uri(2), uri(3)]);

    // An observer with no occurrences gets an empty page, not everyone's.
    let feed = feeds::get_explore_feed(&db.pool, &observer("did:plc:nobody"), &[])
        .await
        .unwrap();
    assert!(feed.is_empty(), "got {:?}", uris(&feed));

    // Combined with taxon, date window, and quality: alice's January Acer
    // occurrences with media, excluding bob's matching one.
    let combined = ExploreFeedOptions {
        taxon: Some("acer".into()),
        start_date: Some("2026-01-01".into()),
        end_date: Some("2026-01-31".into()),
        quality: "HAS_MEDIA".parse().unwrap(),
        ..observer(ALICE)
    };
    let feed = feeds::get_explore_feed(&db.pool, &combined, &[])
        .await
        .unwrap();
    assert_eq!(uris(&feed), [uri(0), uri(3)]);

    // Pagination keeps the filter on every page.
    let page_size = ExploreFeedOptions {
        limit: Some(2),
        ..observer(ALICE)
    };
    let first = feeds::get_explore_feed(&db.pool, &page_size, &[])
        .await
        .unwrap();
    assert_eq!(uris(&first), [uri(0), uri(1)]);
    let last = first.last().unwrap();
    let next = ExploreFeedOptions {
        cursor: Some(format!("{}|{}", last.created_at.to_rfc3339(), last.uri)),
        ..page_size
    };
    let second = feeds::get_explore_feed(&db.pool, &next, &[]).await.unwrap();
    assert_eq!(uris(&second), [uri(2), uri(3)]);

    db.drop().await;
}
