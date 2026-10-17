//! The profile feed runs its counts and its two pages as concurrent queries;
//! check each still returns the right rows and respects the feed type.

mod common;

use chrono::{Duration, Utc};
use observing_db::types::{
    ProfileFeedOptions, ProfileFeedType, UpsertIdentificationParams, UpsertOccurrenceParams,
};
use observing_db::{feeds, identifications, occurrences};

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

fn identification(did: &str, n: i64, subject_uri: &str) -> UpsertIdentificationParams {
    UpsertIdentificationParams {
        uri: format!("at://{did}/bio.lexicons.temp.v0-1.identification/r{n}"),
        cid: "bafyidentification".into(),
        did: did.into(),
        subject_uri: subject_uri.into(),
        subject_cid: "bafyoccurrence".into(),
        scientific_name: "Acer rubrum".into(),
        taxon_rank: None,
        taxon_id: None,
        date_identified: Utc::now() - Duration::minutes(n),
        kingdom: Some("Plantae".into()),
        accepted_taxon_key: None,
    }
}

fn options(feed_type: ProfileFeedType) -> ProfileFeedOptions {
    ProfileFeedOptions {
        limit: Some(2),
        cursor: None,
        feed_type: Some(feed_type),
    }
}

#[tokio::test]
async fn profile_feed_returns_counts_and_newest_pages() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let names = ["Acer rubrum", "Acer rubrum", "Quercus alba"];
    for (n, name) in names.into_iter().enumerate() {
        occurrences::upsert(&db.pool, &occurrence(ALICE, n as i64, name))
            .await
            .unwrap();
    }
    occurrences::upsert(&db.pool, &occurrence(BOB, 0, "Pinus strobus"))
        .await
        .unwrap();
    let bobs = occurrence(BOB, 0, "Pinus strobus").uri;
    for n in 0..3 {
        identifications::upsert(&db.pool, &identification(ALICE, n, &bobs))
            .await
            .unwrap();
    }

    let feed = feeds::get_profile_feed(&db.pool, ALICE, &options(ProfileFeedType::All))
        .await
        .unwrap();
    assert_eq!(feed.counts.observations, 3);
    assert_eq!(feed.counts.identifications, 3);
    assert_eq!(feed.counts.species, 2);
    let occurrence_uris: Vec<_> = feed.occurrences.iter().map(|o| o.uri.as_str()).collect();
    assert_eq!(
        occurrence_uris,
        [
            occurrence(ALICE, 0, "").uri.as_str(),
            occurrence(ALICE, 1, "").uri.as_str()
        ],
        "newest two of alice's occurrences"
    );
    let identification_uris: Vec<_> = feed
        .identifications
        .iter()
        .map(|i| i.uri.as_str())
        .collect();
    assert_eq!(
        identification_uris,
        [
            identification(ALICE, 0, "").uri.as_str(),
            identification(ALICE, 1, "").uri.as_str()
        ],
        "newest two of alice's identifications"
    );

    let observations =
        feeds::get_profile_feed(&db.pool, ALICE, &options(ProfileFeedType::Observations))
            .await
            .unwrap();
    assert_eq!(observations.occurrences.len(), 2);
    assert!(observations.identifications.is_empty());
    assert_eq!(
        observations.counts.identifications, 3,
        "counts are always returned"
    );

    let ids = feeds::get_profile_feed(&db.pool, ALICE, &options(ProfileFeedType::Identifications))
        .await
        .unwrap();
    assert!(ids.occurrences.is_empty());
    assert_eq!(ids.identifications.len(), 2);

    db.drop().await;
}
