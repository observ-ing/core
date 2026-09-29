//! Regression tests for notification dedupe (#858, found by the ingester sim
//! in #854): a redelivered or edited record notifies once.

mod common;

use observing_db::notifications;

const OCCURRENCE: &str = "at://did:plc:alice/bio.lexicons.temp.v0-1.occurrence/r0";
const LIKE: &str = "at://did:plc:bob/ing.observ.temp.like/r0";

async fn count(pool: &sqlx::PgPool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM notifications")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn redelivered_record_notifies_once() {
    let Some(db) = common::scratch().await else {
        return;
    };
    for _ in 0..2 {
        notifications::create(
            &db.pool,
            "did:plc:alice",
            "did:plc:bob",
            "like",
            OCCURRENCE,
            LIKE,
        )
        .await
        .unwrap();
    }
    assert_eq!(count(&db.pool).await, 1);
    db.drop().await;
}

#[tokio::test]
async fn reused_record_key_still_notifies_the_new_recipient() {
    // A deleted record's rkey can be reused for a record on someone else's
    // occurrence; that person should still be notified.
    let Some(db) = common::scratch().await else {
        return;
    };
    notifications::create(
        &db.pool,
        "did:plc:alice",
        "did:plc:bob",
        "like",
        OCCURRENCE,
        LIKE,
    )
    .await
    .unwrap();
    let carols = "at://did:plc:carol/bio.lexicons.temp.v0-1.occurrence/r0";
    notifications::create(
        &db.pool,
        "did:plc:carol",
        "did:plc:bob",
        "like",
        carols,
        LIKE,
    )
    .await
    .unwrap();
    assert_eq!(count(&db.pool).await, 2);
    db.drop().await;
}

#[tokio::test]
async fn migration_merges_existing_duplicates_and_keeps_read_state() {
    let Some(db) = common::scratch().await else {
        return;
    };
    // Recreate the pre-migration state: no unique index, duplicates, and read
    // markers on some of them.
    sqlx::raw_sql(
        "DROP INDEX ingester.notifications_once_per_reference_idx;
         INSERT INTO ingester.notifications
             (id, recipient_did, actor_did, kind, subject_uri, reference_uri) VALUES
             (1, 'alice', 'bob',   'like',           'occ', 'like1'),
             (2, 'alice', 'bob',   'like',           'occ', 'like1'),
             (3, 'alice', 'bob',   'like',           'occ', 'like1'),
             (4, 'alice', 'carol', 'identification', 'occ', 'id1'),
             (5, 'alice', 'carol', 'identification', 'occ', 'id1'),
             (6, 'alice', 'dave',  'comment',        'occ', NULL),
             (7, 'alice', 'dave',  'comment',        'occ', NULL);
         INSERT INTO appview.notification_reads (notification_id, read_at) VALUES
             (2, '2026-01-02'), (4, '2026-01-01'), (5, '2026-01-03');",
    )
    .execute(&db.pool)
    .await
    .unwrap();

    let mut tx = db.pool.begin().await.unwrap();
    sqlx::raw_sql(include_str!(
        "../migrations/20260928000000_notifications_dedupe.sql"
    ))
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let kept: Vec<(i64, bool)> = sqlx::query_as(
        "SELECT n.id, r.notification_id IS NOT NULL
         FROM ingester.notifications n
         LEFT JOIN appview.notification_reads r ON r.notification_id = n.id
         ORDER BY n.id",
    )
    .fetch_all(&db.pool)
    .await
    .unwrap();
    // 1 survives and inherits 2's read marker; 4 keeps its own; the NULL
    // references stay distinct and unread.
    assert_eq!(kept, vec![(1, true), (4, true), (6, false), (7, false)]);

    let orphaned_reads: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM appview.notification_reads
         WHERE notification_id NOT IN (SELECT id FROM ingester.notifications)",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(orphaned_reads, 0);
    db.drop().await;
}
