//! Appview sign-in sessions: a session is found only by its token hash and
//! only until it expires or is deleted.

use crate::common;

use chrono::{Duration, Utc};
use observing_db::app_sessions;

const ALICE: &str = "did:plc:alice";

fn hash(byte: u8) -> [u8; 32] {
    [byte; 32]
}

#[tokio::test]
async fn a_live_session_is_found_by_its_hash_and_touched() {
    let Some(db) = common::scratch().await else {
        return;
    };
    app_sessions::create(&db.pool, &hash(1), ALICE, Utc::now() + Duration::hours(1))
        .await
        .unwrap();
    sqlx::query("UPDATE appview.app_sessions SET last_used_at = NOW() - INTERVAL '1 day'")
        .execute(&db.pool)
        .await
        .unwrap();

    let did = app_sessions::lookup(&db.pool, &hash(1)).await.unwrap();
    assert_eq!(did.as_deref(), Some(ALICE));
    let touched: bool = sqlx::query_scalar(
        "SELECT last_used_at > NOW() - INTERVAL '1 minute' FROM appview.app_sessions",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert!(touched, "lookup updates last_used_at");

    assert_eq!(
        app_sessions::lookup(&db.pool, &hash(2)).await.unwrap(),
        None
    );
    db.drop().await;
}

#[tokio::test]
async fn an_expired_session_is_not_found() {
    let Some(db) = common::scratch().await else {
        return;
    };
    app_sessions::create(&db.pool, &hash(1), ALICE, Utc::now() - Duration::seconds(1))
        .await
        .unwrap();

    assert_eq!(
        app_sessions::lookup(&db.pool, &hash(1)).await.unwrap(),
        None
    );
    assert_eq!(app_sessions::delete_expired(&db.pool).await.unwrap(), 1);
    db.drop().await;
}

#[tokio::test]
async fn a_deleted_session_is_not_found() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let expires = Utc::now() + Duration::hours(1);
    app_sessions::create(&db.pool, &hash(1), ALICE, expires)
        .await
        .unwrap();

    let deleted = app_sessions::delete(&db.pool, &hash(1)).await.unwrap();
    assert_eq!(deleted.as_deref(), Some(ALICE));
    assert_eq!(
        app_sessions::lookup(&db.pool, &hash(1)).await.unwrap(),
        None
    );
    assert_eq!(
        app_sessions::delete(&db.pool, &hash(1)).await.unwrap(),
        None
    );
    db.drop().await;
}

#[tokio::test]
async fn deleting_all_for_a_did_leaves_other_users_signed_in() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let expires = Utc::now() + Duration::hours(1);
    app_sessions::create(&db.pool, &hash(1), ALICE, expires)
        .await
        .unwrap();
    app_sessions::create(&db.pool, &hash(2), ALICE, expires)
        .await
        .unwrap();
    app_sessions::create(&db.pool, &hash(3), "did:plc:bob", expires)
        .await
        .unwrap();

    assert_eq!(
        app_sessions::delete_all_for_did(&db.pool, ALICE)
            .await
            .unwrap(),
        2
    );
    assert_eq!(
        app_sessions::lookup(&db.pool, &hash(1)).await.unwrap(),
        None
    );
    assert_eq!(
        app_sessions::lookup(&db.pool, &hash(2)).await.unwrap(),
        None
    );
    assert_eq!(
        app_sessions::lookup(&db.pool, &hash(3))
            .await
            .unwrap()
            .as_deref(),
        Some("did:plc:bob")
    );
    db.drop().await;
}
