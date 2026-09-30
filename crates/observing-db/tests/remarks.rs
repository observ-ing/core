//! Read-time resolution of author-written remarks (#839): a remark fills a
//! term only while the occurrence's forward reference points at it, and only
//! when the remark agrees on author, subject and term.

mod common;

use chrono::Utc;
use observing_db::remarks::{self, EVENT_REMARKS, OCCURRENCE_REMARKS};
use observing_db::types::{UpsertOccurrenceParams, UpsertRemarkParams};
use observing_db::{occurrences, PgPool};

const ALICE: &str = "did:plc:alice";
const MALLORY: &str = "did:plc:mallory";
const OCC: &str = "at://did:plc:alice/bio.lexicons.temp.v0-1.occurrence/r0";

fn remark_uri(did: &str, rkey: &str) -> String {
    format!("at://{did}/bio.lexicons.temp.v0-1.remark/{rkey}")
}

fn occurrence(
    occurrence_remarks: Option<&str>,
    event_remarks: Option<&str>,
) -> UpsertOccurrenceParams {
    UpsertOccurrenceParams {
        uri: OCC.into(),
        cid: "bafyoccurrence".into(),
        did: ALICE.into(),
        scientific_name: None,
        event_date_start: None,
        event_date_end: None,
        event_date_raw: None,
        longitude: Some(-122.4194),
        latitude: Some(37.7749),
        coordinate_uncertainty_meters: None,
        organism_quantity: None,
        organism_quantity_type: None,
        associated_media: None,
        external_records: None,
        occurrence_remarks_uri: occurrence_remarks.map(str::to_string),
        event_remarks_uri: event_remarks.map(str::to_string),
        recorded_by: None,
        taxon_id: None,
        taxon_rank: None,
        kingdom: None,
        created_at: Utc::now(),
    }
}

fn remark(uri: &str, did: &str, subject: &str, term: &str, body: &str) -> UpsertRemarkParams {
    UpsertRemarkParams {
        uri: uri.into(),
        cid: "bafyremark".into(),
        did: did.into(),
        subject_uri: subject.into(),
        dwc_term: term.into(),
        body: body.into(),
        license: None,
    }
}

/// `(dwc_term, body)` pairs resolved for the test occurrence, sorted by term.
async fn resolved(pool: &PgPool) -> Vec<(String, String)> {
    let mut rows: Vec<_> = remarks::get_for_occurrences(pool, &[OCC.to_string()])
        .await
        .unwrap()
        .into_iter()
        .map(|r| (r.dwc_term, r.body))
        .collect();
    rows.sort();
    rows
}

/// The appview writes the remark before the occurrence, but either may be
/// ingested first; both orders resolve once both rows exist.
#[tokio::test]
async fn resolves_in_either_arrival_order() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let organism = remark_uri(ALICE, "a");
    let event = remark_uri(ALICE, "b");

    // Remark first: nothing references it yet, so it fills nothing.
    remarks::upsert(
        &db.pool,
        &remark(&organism, ALICE, OCC, OCCURRENCE_REMARKS, "Worn wings."),
    )
    .await
    .unwrap();
    assert!(resolved(&db.pool).await.is_empty());

    occurrences::upsert(&db.pool, &occurrence(Some(&organism), Some(&event)))
        .await
        .unwrap();
    assert_eq!(
        resolved(&db.pool).await,
        vec![(OCCURRENCE_REMARKS.into(), "Worn wings.".into())],
        "the event remark is referenced but not ingested yet"
    );

    // Referenced remark arrives after its occurrence.
    remarks::upsert(
        &db.pool,
        &remark(&event, ALICE, OCC, EVENT_REMARKS, "Light drizzle."),
    )
    .await
    .unwrap();
    assert_eq!(
        resolved(&db.pool).await,
        vec![
            (EVENT_REMARKS.into(), "Light drizzle.".into()),
            (OCCURRENCE_REMARKS.into(), "Worn wings.".into()),
        ]
    );
    db.drop().await;
}

/// A `putRecord` on the occurrence can swing the reference to a new remark;
/// the old one is orphaned and stops filling the term. Dropping the
/// reference clears it.
#[tokio::test]
async fn follows_the_occurrence_reference() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let old = remark_uri(ALICE, "old");
    let new = remark_uri(ALICE, "new");
    remarks::upsert(
        &db.pool,
        &remark(&old, ALICE, OCC, OCCURRENCE_REMARKS, "old"),
    )
    .await
    .unwrap();
    remarks::upsert(
        &db.pool,
        &remark(&new, ALICE, OCC, OCCURRENCE_REMARKS, "new"),
    )
    .await
    .unwrap();

    occurrences::upsert(&db.pool, &occurrence(Some(&old), None))
        .await
        .unwrap();
    assert_eq!(resolved(&db.pool).await[0].1, "old");

    occurrences::upsert(&db.pool, &occurrence(Some(&new), None))
        .await
        .unwrap();
    assert_eq!(
        resolved(&db.pool).await,
        vec![(OCCURRENCE_REMARKS.into(), "new".into())]
    );

    occurrences::upsert(&db.pool, &occurrence(None, None))
        .await
        .unwrap();
    assert!(resolved(&db.pool).await.is_empty());
    db.drop().await;
}

/// A reference whose remark disagrees on author, subject or term points at
/// the wrong record and fills nothing — so text can't be attached to someone
/// else's observation, and a remark can't fill a term it wasn't written for.
#[tokio::test]
async fn ignores_a_remark_that_disagrees_with_the_reference() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let foreign = remark_uri(MALLORY, "a");
    let wrong_subject = remark_uri(ALICE, "b");
    let wrong_term = remark_uri(ALICE, "c");
    remarks::upsert(
        &db.pool,
        &remark(&foreign, MALLORY, OCC, OCCURRENCE_REMARKS, "spam"),
    )
    .await
    .unwrap();
    remarks::upsert(
        &db.pool,
        &remark(
            &wrong_subject,
            ALICE,
            "at://did:plc:alice/bio.lexicons.temp.v0-1.occurrence/other",
            OCCURRENCE_REMARKS,
            "about another observation",
        ),
    )
    .await
    .unwrap();
    remarks::upsert(
        &db.pool,
        &remark(&wrong_term, ALICE, OCC, EVENT_REMARKS, "event text"),
    )
    .await
    .unwrap();

    for uri in [&foreign, &wrong_subject, &wrong_term] {
        occurrences::upsert(&db.pool, &occurrence(Some(uri), None))
            .await
            .unwrap();
        assert!(
            resolved(&db.pool).await.is_empty(),
            "{uri} must not resolve"
        );
    }

    // A third party naming Alice's occurrence as their subject doesn't block
    // or displace Alice's own remark.
    let own = remark_uri(ALICE, "d");
    remarks::upsert(
        &db.pool,
        &remark(&own, ALICE, OCC, OCCURRENCE_REMARKS, "mine"),
    )
    .await
    .unwrap();
    occurrences::upsert(&db.pool, &occurrence(Some(&own), None))
        .await
        .unwrap();
    assert_eq!(
        resolved(&db.pool).await,
        vec![(OCCURRENCE_REMARKS.into(), "mine".into())]
    );
    assert_eq!(
        remarks::get_uris_for_subject(&db.pool, OCC, ALICE)
            .await
            .unwrap()
            .len(),
        2,
        "cleanup on delete covers only Alice's own remarks naming the occurrence"
    );
    db.drop().await;
}
