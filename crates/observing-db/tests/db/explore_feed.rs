//! The explore feed's filters: `observer` limits results to one user's
//! occurrences, on its own and combined with the other filters and the
//! keyset cursor; `taxon` matches the community ID's taxon or any of its
//! ancestors.

use crate::common;

use chrono::{DateTime, Duration, TimeZone, Utc};
use observing_db::taxa::{self, TaxonRow};
use observing_db::types::{
    ExploreFeedOptions, OccurrenceRow, UpsertIdentificationParams, UpsertOccurrenceParams,
};
use observing_db::{feeds, identifications, occurrences};

const ALICE: &str = "did:plc:alice";
const BOB: &str = "did:plc:bob";

/// An occurrence as the ingester stores it: the record carries no taxon, so
/// `scientific_name` is always NULL. Its taxon comes from identifications;
/// see [`identify`].
fn occurrence(did: &str, n: i64) -> UpsertOccurrenceParams {
    UpsertOccurrenceParams {
        uri: format!("at://{did}/bio.lexicons.temp.v0-1.occurrence/r{n}"),
        cid: "bafyoccurrence".into(),
        did: did.into(),
        scientific_name: None,
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

/// A resolved species in the `taxa` cache with its Linnaean ancestry.
fn species(taxon_key: i64, name: &str, genus: &str, family: &str) -> TaxonRow {
    TaxonRow {
        taxon_key,
        scientific_name: name.into(),
        authorship: None,
        rank: "SPECIES".into(),
        status: "ACCEPTED".into(),
        accepted_taxon_key: None,
        parent_key: None,
        kingdom: Some("Plantae".into()),
        kingdom_key: None,
        phylum: Some("Tracheophyta".into()),
        phylum_key: None,
        class: Some("Magnoliopsida".into()),
        class_key: None,
        order_: None,
        order_key: None,
        family: Some(family.into()),
        family_key: None,
        genus: Some(genus.into()),
        genus_key: None,
        species: Some(name.into()),
        species_key: Some(taxon_key),
        vernacular_name: None,
        extinct: None,
        fetched_at: Utc::now(),
        source: "gbif".into(),
    }
}

/// Identify `occurrence` as `taxon`, the only way an occurrence gets a
/// taxon. Call [`identifications::refresh_community_ids`] afterwards.
async fn identify(pool: &sqlx::PgPool, occurrence: &UpsertOccurrenceParams, taxon: &TaxonRow) {
    identifications::upsert(
        pool,
        &UpsertIdentificationParams {
            uri: format!(
                "{}-id",
                occurrence.uri.replace("occurrence", "identification")
            ),
            cid: "bafyidentification".into(),
            did: occurrence.did.clone(),
            subject_uri: occurrence.uri.clone(),
            subject_cid: occurrence.cid.clone(),
            scientific_name: taxon.scientific_name.clone(),
            taxon_rank: Some("species".into()),
            taxon_id: None,
            date_identified: Utc::now(),
            kingdom: taxon.kingdom.clone(),
            accepted_taxon_key: Some(taxon.taxon_key),
        },
    )
    .await
    .unwrap();
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
    let rubrum = species(1, "Acer rubrum", "Acer", "Sapindaceae");
    let saccharum = species(2, "Acer saccharum", "Acer", "Sapindaceae");
    let alba = species(3, "Quercus alba", "Quercus", "Fagaceae");
    let negundo = species(4, "Acer negundo", "Acer", "Sapindaceae");
    taxa::upsert_many(
        &db.pool,
        &[
            rubrum.clone(),
            saccharum.clone(),
            alba.clone(),
            negundo.clone(),
        ],
    )
    .await
    .unwrap();
    let rows = [
        (with_media(on_day(occurrence(ALICE, 0), jan)), &rubrum),
        (on_day(occurrence(ALICE, 1), jun), &saccharum),
        (with_media(on_day(occurrence(ALICE, 2), jan)), &alba),
        (with_media(on_day(occurrence(ALICE, 3), jan)), &negundo),
        (with_media(on_day(occurrence(BOB, 4), jan)), &rubrum),
    ];
    for (row, taxon) in &rows {
        occurrences::upsert(&db.pool, row).await.unwrap();
        identify(&db.pool, row, taxon).await;
    }
    identifications::refresh_community_ids(&db.pool)
        .await
        .unwrap();
    let rows = rows.map(|(row, _)| row);
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
        taxon: Some("Acer".into()),
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

#[tokio::test]
async fn explore_feed_filters_by_community_taxon() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let coyote_brush = species(10, "Baccharis pilularis", "Baccharis", "Asteraceae");
    let mule_fat = species(11, "Baccharis salicifolia", "Baccharis", "Asteraceae");
    let poppy = species(
        12,
        "Eschscholzia californica",
        "Eschscholzia",
        "Papaveraceae",
    );
    taxa::upsert_many(
        &db.pool,
        &[coyote_brush.clone(), mule_fat.clone(), poppy.clone()],
    )
    .await
    .unwrap();
    let rows = [
        occurrence(ALICE, 0),
        occurrence(BOB, 1),
        occurrence(ALICE, 2),
        // Never identified, so it has no taxon to match.
        occurrence(BOB, 3),
    ];
    for row in &rows {
        occurrences::upsert(&db.pool, row).await.unwrap();
    }
    identify(&db.pool, &rows[0], &coyote_brush).await;
    identify(&db.pool, &rows[1], &mule_fat).await;
    identify(&db.pool, &rows[2], &poppy).await;
    identifications::refresh_community_ids(&db.pool)
        .await
        .unwrap();
    let uri = |i: usize| rows[i].uri.as_str();
    let by_taxon = |taxon: &str| ExploreFeedOptions {
        taxon: Some(taxon.into()),
        ..Default::default()
    };

    // A species matches its own observations.
    let feed = feeds::get_explore_feed(&db.pool, &by_taxon("Baccharis pilularis"), &[])
        .await
        .unwrap();
    assert_eq!(uris(&feed), [uri(0)]);

    // Case-insensitive, since the field accepts free text.
    let feed = feeds::get_explore_feed(&db.pool, &by_taxon("baccharis pilularis"), &[])
        .await
        .unwrap();
    assert_eq!(uris(&feed), [uri(0)]);

    // A higher taxon matches observations of its descendants.
    let feed = feeds::get_explore_feed(&db.pool, &by_taxon("Baccharis"), &[])
        .await
        .unwrap();
    assert_eq!(uris(&feed), [uri(0), uri(1)]);
    let feed = feeds::get_explore_feed(&db.pool, &by_taxon("Asteraceae"), &[])
        .await
        .unwrap();
    assert_eq!(uris(&feed), [uri(0), uri(1)]);

    // A name prefix is not a taxon: "Bacc" must not match Baccharis.
    let feed = feeds::get_explore_feed(&db.pool, &by_taxon("Bacc"), &[])
        .await
        .unwrap();
    assert!(feed.is_empty(), "got {:?}", uris(&feed));

    db.drop().await;
}
