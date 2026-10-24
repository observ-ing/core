//! Regression tests for records that arrive before the occurrence they
//! reference (found by the ingester sim in #854): the owner is notified
//! when the occurrence lands. Tap orders records within a repo, not across
//! repos, so an identification of bob's occurrence can arrive first.

mod common;

use chrono::{TimeZone, Utc};
use observing_db::types::{
    CreateLikeParams, UpsertCommentParams, UpsertIdentificationParams, UpsertOccurrenceParams,
};
use observing_db::{comments, identifications, likes, notifications, occurrences};

const OCCURRENCE: &str = "at://did:plc:bob/bio.lexicons.temp.v0-1.occurrence/r1";
const IDENTIFICATION: &str = "at://did:plc:alice/bio.lexicons.temp.v0-1.identification/r0";

fn occurrence() -> UpsertOccurrenceParams {
    UpsertOccurrenceParams {
        uri: OCCURRENCE.into(),
        cid: "bafyoccurrence".into(),
        did: "did:plc:bob".into(),
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
        uri: IDENTIFICATION.into(),
        cid: "bafyidentification".into(),
        did: "did:plc:alice".into(),
        subject_uri: OCCURRENCE.into(),
        subject_cid: "bafyoccurrence".into(),
        scientific_name: "Quercus alba".into(),
        taxon_rank: None,
        taxon_id: None,
        date_identified: Utc.with_ymd_and_hms(2024, 6, 15, 8, 30, 0).unwrap(),
        kingdom: None,
        accepted_taxon_key: None,
    }
}

/// The tap-ingester's occurrence write path.
async fn ingest_occurrence(pool: &sqlx::PgPool) {
    occurrences::upsert(pool, &occurrence()).await.unwrap();
    notifications::create_for_existing_references(pool, "did:plc:bob", OCCURRENCE)
        .await
        .unwrap();
}

async fn notified(pool: &sqlx::PgPool) -> Vec<(String, String, String, String)> {
    sqlx::query_as(
        "SELECT recipient_did, actor_did, kind, reference_uri FROM notifications \
         WHERE subject_uri = $1 ORDER BY kind",
    )
    .bind(OCCURRENCE)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn identification_before_occurrence_notifies_owner() {
    let Some(db) = common::scratch().await else {
        return;
    };
    identifications::upsert(&db.pool, &identification())
        .await
        .unwrap();
    ingest_occurrence(&db.pool).await;

    assert_eq!(
        notified(&db.pool).await,
        vec![(
            "did:plc:bob".into(),
            "did:plc:alice".into(),
            "identification".into(),
            IDENTIFICATION.into(),
        )]
    );
    db.drop().await;
}

#[tokio::test]
async fn early_like_and_comment_notify_but_own_records_do_not() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let like = "at://did:plc:carol/ing.observ.temp.like/r0";
    likes::create(
        &db.pool,
        &CreateLikeParams {
            uri: like.into(),
            cid: "bafylike".into(),
            did: "did:plc:carol".into(),
            subject_uri: OCCURRENCE.into(),
            subject_cid: "bafyoccurrence".into(),
            created_at: Utc::now().naive_utc(),
        },
    )
    .await
    .unwrap();
    for (did, uri) in [
        (
            "did:plc:alice",
            "at://did:plc:alice/ing.observ.temp.comment/r0",
        ),
        ("did:plc:bob", "at://did:plc:bob/ing.observ.temp.comment/r0"),
    ] {
        comments::upsert(
            &db.pool,
            &UpsertCommentParams {
                uri: uri.into(),
                cid: "bafycomment".into(),
                did: did.into(),
                subject_uri: OCCURRENCE.into(),
                subject_cid: "bafyoccurrence".into(),
                body: "nice".into(),
                reply_to_uri: None,
                reply_to_cid: None,
                created_at: Utc::now(),
            },
        )
        .await
        .unwrap();
    }
    ingest_occurrence(&db.pool).await;

    assert_eq!(
        notified(&db.pool).await,
        vec![
            (
                "did:plc:bob".into(),
                "did:plc:alice".into(),
                "comment".into(),
                "at://did:plc:alice/ing.observ.temp.comment/r0".into(),
            ),
            (
                "did:plc:bob".into(),
                "did:plc:carol".into(),
                "like".into(),
                like.into(),
            ),
        ]
    );
    db.drop().await;
}

#[tokio::test]
async fn occurrence_edit_does_not_renotify() {
    let Some(db) = common::scratch().await else {
        return;
    };
    // The usual order: the occurrence, then the identification, which
    // notifies through `create`.
    occurrences::upsert(&db.pool, &occurrence()).await.unwrap();
    identifications::upsert(&db.pool, &identification())
        .await
        .unwrap();
    notifications::create(
        &db.pool,
        "did:plc:bob",
        "did:plc:alice",
        "identification",
        OCCURRENCE,
        IDENTIFICATION,
    )
    .await
    .unwrap();
    // An edit (or redelivery) of the occurrence.
    ingest_occurrence(&db.pool).await;

    assert_eq!(notified(&db.pool).await.len(), 1);
    db.drop().await;
}
