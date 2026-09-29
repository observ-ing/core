//! Regression tests for likes (#859, found by the ingester sim in #854): the
//! database keeps every like record, so a double tap followed by an unlike of
//! one record doesn't lose the other, and replays are idempotent.

mod common;

use chrono::NaiveDate;
use observing_db::likes;
use observing_db::types::CreateLikeParams;

const OCCURRENCE: &str = "at://did:plc:alice/bio.lexicons.temp.v0-1.occurrence/r0";
const BOB: &str = "did:plc:bob";

fn like(rkey: &str, subject: &str) -> CreateLikeParams {
    CreateLikeParams {
        uri: format!("at://{BOB}/ing.observ.temp.like/{rkey}"),
        cid: format!("bafylike{rkey}"),
        did: BOB.into(),
        subject_uri: subject.into(),
        subject_cid: "bafyoccurrence".into(),
        created_at: NaiveDate::from_ymd_opt(2024, 6, 15)
            .unwrap()
            .and_hms_opt(8, 30, 0)
            .unwrap(),
    }
}

#[tokio::test]
async fn double_like_keeps_both_records_and_counts_once() {
    let Some(db) = common::scratch().await else {
        return;
    };
    likes::create(&db.pool, &like("r0", OCCURRENCE))
        .await
        .unwrap();
    likes::create(&db.pool, &like("r1", OCCURRENCE))
        .await
        .unwrap();

    let uris = likes::find_uris_by_subject_and_did(&db.pool, OCCURRENCE, BOB)
        .await
        .unwrap();
    assert_eq!(uris.len(), 2, "both like records are stored");
    let counts = likes::get_counts_for_occurrences(&db.pool, &[OCCURRENCE.to_string()])
        .await
        .unwrap();
    assert_eq!(counts.get(OCCURRENCE), Some(&1), "one liker, one like");
    db.drop().await;
}

#[tokio::test]
async fn deleting_one_of_two_like_records_leaves_it_liked() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let first = like("r0", OCCURRENCE);
    likes::create(&db.pool, &first).await.unwrap();
    likes::create(&db.pool, &like("r1", OCCURRENCE))
        .await
        .unwrap();
    likes::delete(&db.pool, &first.uri).await.unwrap();

    let liked = likes::get_user_like_statuses(&db.pool, &[OCCURRENCE.to_string()], BOB)
        .await
        .unwrap();
    assert!(liked.contains(OCCURRENCE), "the repo still holds a like");
    db.drop().await;
}

#[tokio::test]
async fn replaying_an_older_version_of_a_like_is_not_an_error() {
    // A cursor rewind replays a like's history in order; each step must apply
    // cleanly, ending at the latest version.
    let Some(db) = common::scratch().await else {
        return;
    };
    let other = "at://did:plc:carol/bio.lexicons.temp.v0-1.occurrence/r0";
    likes::create(&db.pool, &like("r0", OCCURRENCE))
        .await
        .unwrap();
    likes::create(&db.pool, &like("r0", other)).await.unwrap();
    likes::create(&db.pool, &like("r0", OCCURRENCE))
        .await
        .unwrap();
    likes::create(&db.pool, &like("r0", other)).await.unwrap();

    let subject: String = sqlx::query_scalar("SELECT subject_uri FROM likes WHERE did = $1")
        .bind(BOB)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(subject, other);
    db.drop().await;
}
