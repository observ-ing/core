//! App sign-in codes: a code is taken once, and not after it expires.

use crate::common;

use chrono::{Duration, Utc};
use observing_db::app_login_codes::{self, LoginCode};

const ALICE: &str = "did:plc:alice";

fn hash(byte: u8) -> [u8; 32] {
    [byte; 32]
}

#[tokio::test]
async fn a_code_is_taken_once() {
    let Some(db) = common::scratch().await else {
        return;
    };
    app_login_codes::create(
        &db.pool,
        &hash(1),
        ALICE,
        "challenge",
        Utc::now() + Duration::minutes(2),
    )
    .await
    .unwrap();

    let taken = app_login_codes::take(&db.pool, &hash(1)).await.unwrap();
    assert_eq!(
        taken,
        Some(LoginCode {
            did: ALICE.into(),
            code_challenge: "challenge".into()
        })
    );
    assert_eq!(
        app_login_codes::take(&db.pool, &hash(1)).await.unwrap(),
        None
    );
    assert_eq!(
        app_login_codes::take(&db.pool, &hash(2)).await.unwrap(),
        None
    );
    db.drop().await;
}

#[tokio::test]
async fn an_expired_code_is_refused_and_still_used_up() {
    let Some(db) = common::scratch().await else {
        return;
    };
    app_login_codes::create(
        &db.pool,
        &hash(1),
        ALICE,
        "challenge",
        Utc::now() - Duration::seconds(1),
    )
    .await
    .unwrap();

    assert_eq!(
        app_login_codes::take(&db.pool, &hash(1)).await.unwrap(),
        None
    );
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM appview.app_login_codes")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(left, 0, "taking an expired code deletes it");
    db.drop().await;
}

#[tokio::test]
async fn delete_expired_keeps_live_codes() {
    let Some(db) = common::scratch().await else {
        return;
    };
    app_login_codes::create(
        &db.pool,
        &hash(1),
        ALICE,
        "a",
        Utc::now() - Duration::seconds(1),
    )
    .await
    .unwrap();
    app_login_codes::create(
        &db.pool,
        &hash(2),
        ALICE,
        "b",
        Utc::now() + Duration::minutes(2),
    )
    .await
    .unwrap();

    assert_eq!(app_login_codes::delete_expired(&db.pool).await.unwrap(), 1);
    assert!(app_login_codes::take(&db.pool, &hash(2))
        .await
        .unwrap()
        .is_some());
    db.drop().await;
}
