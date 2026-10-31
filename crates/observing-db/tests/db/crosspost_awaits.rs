//! Cross-posts queued as their occurrence is created (#998) wait for the
//! ingester to index the records the request wrote before they run, and the
//! waiting doesn't use up the attempts a cross-post gets.

use crate::common;

use chrono::{Duration, Utc};
use observing_db::types::{UpsertIdentificationParams, UpsertOccurrenceParams, UpsertRemarkParams};
use observing_db::{crossposts, identifications, occurrences, remarks};

const ALICE: &str = "did:plc:alice";
const SERVICE: &str = "inaturalist";
const OCC: &str = "at://did:plc:alice/bio.lexicons.temp.v0-1.occurrence/r0";
const ID: &str = "at://did:plc:alice/bio.lexicons.temp.v0-1.identification/i0";
const REMARK: &str = "at://did:plc:alice/bio.lexicons.temp.v0-1.remark/m0";

/// What the request that created the occurrence wrote.
fn written() -> Vec<String> {
    vec![REMARK.into(), OCC.into(), ID.into()]
}

fn occurrence() -> UpsertOccurrenceParams {
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
        occurrence_remarks_uri: None,
        event_remarks_uri: None,
        recorded_by: None,
        taxon_id: None,
        taxon_rank: None,
        kingdom: None,
        created_at: Utc::now(),
    }
}

fn identification() -> UpsertIdentificationParams {
    UpsertIdentificationParams {
        uri: ID.into(),
        cid: "bafyidentification".into(),
        did: ALICE.into(),
        subject_uri: OCC.into(),
        subject_cid: "bafyoccurrence".into(),
        scientific_name: "Coccinella septempunctata".into(),
        taxon_rank: Some("species".into()),
        taxon_id: None,
        date_identified: Utc::now(),
        kingdom: None,
        accepted_taxon_key: None,
    }
}

fn remark() -> UpsertRemarkParams {
    UpsertRemarkParams {
        uri: REMARK.into(),
        cid: "bafyremark".into(),
        did: ALICE.into(),
        subject_uri: OCC.into(),
        dwc_term: remarks::OCCURRENCE_REMARKS.into(),
        body: "On the fennel by the creek".into(),
        license: None,
    }
}

#[tokio::test]
async fn a_crosspost_waits_for_every_record_written_with_its_occurrence() {
    let Some(db) = common::scratch().await else {
        return;
    };

    assert!(crossposts::all_indexed(&db.pool, &[]).await.unwrap());
    assert!(!crossposts::all_indexed(&db.pool, &written()).await.unwrap());
    // The ingester can index these in any order (see
    // `20260602000000_drop_occurrence_ref_fks.sql`): an identification being
    // in doesn't mean the occurrence it names is.
    identifications::upsert(&db.pool, &identification())
        .await
        .unwrap();
    occurrences::upsert(&db.pool, &occurrence()).await.unwrap();
    assert!(!crossposts::all_indexed(&db.pool, &written()).await.unwrap());
    remarks::upsert(&db.pool, &remark()).await.unwrap();
    assert!(crossposts::all_indexed(&db.pool, &written()).await.unwrap());

    db.drop().await;
}

#[tokio::test]
async fn a_new_crosspost_is_not_claimed_before_its_start_time() {
    let Some(db) = common::scratch().await else {
        return;
    };

    let start = Utc::now() + Duration::seconds(60);
    crossposts::enqueue(&db.pool, OCC, SERVICE, ALICE, &written(), Some(start))
        .await
        .unwrap();
    assert!(crossposts::claim_pending(&db.pool, SERVICE, 1)
        .await
        .unwrap()
        .is_empty());
    let due = crossposts::next_due_at(&db.pool, SERVICE)
        .await
        .unwrap()
        .unwrap();
    assert!(
        (due - start).num_seconds().abs() <= 1,
        "due {due}, start {start}"
    );

    db.drop().await;
}

/// Waiting on the ingester is not a failed attempt: a slow ingester must not
/// use up the attempts meant for iNaturalist's errors.
#[tokio::test]
async fn waiting_on_the_ingester_gives_back_the_attempt_and_comes_due_later() {
    let Some(db) = common::scratch().await else {
        return;
    };

    crossposts::enqueue(&db.pool, OCC, SERVICE, ALICE, &written(), None)
        .await
        .unwrap();
    let claimed = crossposts::claim_pending(&db.pool, SERVICE, 1)
        .await
        .unwrap();
    assert_eq!(claimed[0].awaits_uris, written());
    assert_eq!(claimed[0].attempts, 1);

    crossposts::defer(&db.pool, OCC, SERVICE, Duration::seconds(60))
        .await
        .unwrap();
    let row = crossposts::get(&db.pool, OCC, SERVICE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (row.status.as_str(), row.attempts, row.waits),
        ("pending", 0, 1)
    );
    assert!(crossposts::claim_pending(&db.pool, SERVICE, 1)
        .await
        .unwrap()
        .is_empty());
    let due = crossposts::next_due_at(&db.pool, SERVICE)
        .await
        .unwrap()
        .unwrap();
    assert!(due > Utc::now() + Duration::seconds(55), "due {due}");

    crossposts::clear_awaits(&db.pool, OCC, SERVICE)
        .await
        .unwrap();
    let row = crossposts::get(&db.pool, OCC, SERVICE)
        .await
        .unwrap()
        .unwrap();
    assert!(row.awaits_uris.is_empty());

    db.drop().await;
}

/// A retry is asked for from the occurrence's detail page, so the occurrence
/// is indexed by then; what the original queuing awaited no longer applies.
#[tokio::test]
async fn requeuing_a_failed_crosspost_starts_its_wait_over() {
    let Some(db) = common::scratch().await else {
        return;
    };

    crossposts::enqueue(&db.pool, OCC, SERVICE, ALICE, &written(), None)
        .await
        .unwrap();
    crossposts::claim_pending(&db.pool, SERVICE, 1)
        .await
        .unwrap();
    crossposts::defer(&db.pool, OCC, SERVICE, Duration::seconds(60))
        .await
        .unwrap();
    crossposts::record_failure(&db.pool, OCC, SERVICE, "boom", 0)
        .await
        .unwrap();
    assert!(
        crossposts::enqueue(&db.pool, OCC, SERVICE, ALICE, &[], None)
            .await
            .unwrap()
    );
    let row = crossposts::get(&db.pool, OCC, SERVICE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.status, "pending");
    assert!(row.awaits_uris.is_empty());
    assert_eq!(row.waits, 0);
    // Due now, not when the old wait would have ended.
    assert_eq!(
        crossposts::claim_pending(&db.pool, SERVICE, 1)
            .await
            .unwrap()
            .len(),
        1
    );

    db.drop().await;
}

#[tokio::test]
async fn the_queue_reports_how_much_is_pending_and_since_when() {
    let Some(db) = common::scratch().await else {
        return;
    };

    let empty = crossposts::queue_stats(&db.pool, SERVICE).await.unwrap();
    assert_eq!((empty.pending, empty.oldest), (0, None));

    let before = Utc::now();
    crossposts::enqueue(&db.pool, OCC, SERVICE, ALICE, &[], None)
        .await
        .unwrap();
    let other = "at://did:plc:alice/bio.lexicons.temp.v0-1.occurrence/r1";
    crossposts::enqueue(&db.pool, other, SERVICE, ALICE, &[], None)
        .await
        .unwrap();
    crossposts::mark_synced(&db.pool, other, SERVICE)
        .await
        .unwrap();

    let stats = crossposts::queue_stats(&db.pool, SERVICE).await.unwrap();
    assert_eq!(stats.pending, 1);
    assert!(stats.oldest.unwrap() >= before - Duration::seconds(1));

    db.drop().await;
}
