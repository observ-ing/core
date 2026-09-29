//! Regression tests for identification edits (#857, found by the ingester
//! sim in #854): edits clear removed fields, and a rename re-queues
//! taxonomy resolution instead of keeping the old taxon's key.

mod common;

use chrono::{TimeZone, Utc};
use observing_db::identifications;
use observing_db::types::UpsertIdentificationParams;

const URI: &str = "at://did:plc:bob/bio.lexicons.temp.v0-1.identification/r0";

fn identification(
    name: &str,
    rank: Option<&str>,
    kingdom: Option<&str>,
) -> UpsertIdentificationParams {
    UpsertIdentificationParams {
        uri: URI.into(),
        cid: "bafyidentification".into(),
        did: "did:plc:bob".into(),
        subject_uri: "at://did:plc:alice/bio.lexicons.temp.v0-1.occurrence/r0".into(),
        subject_cid: "bafyoccurrence".into(),
        scientific_name: name.into(),
        taxon_rank: rank.map(str::to_string),
        taxon_id: None,
        date_identified: Utc.with_ymd_and_hms(2024, 6, 15, 8, 30, 0).unwrap(),
        kingdom: kingdom.map(str::to_string),
        // The ingester writes NULL; observing-resolve-taxa fills it in.
        accepted_taxon_key: None,
    }
}

type Row = (String, Option<String>, Option<String>, Option<i64>);

async fn row(pool: &sqlx::PgPool) -> Row {
    sqlx::query_as(
        "SELECT scientific_name, taxon_rank, kingdom, accepted_taxon_key \
         FROM identifications WHERE uri = $1",
    )
    .bind(URI)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Stand-in for an observing-resolve-taxa pass.
async fn resolve(pool: &sqlx::PgPool, key: i64) {
    sqlx::query("UPDATE identifications SET accepted_taxon_key = $1 WHERE uri = $2")
        .bind(key)
        .bind(URI)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn edit_clears_rank_and_kingdom() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let before = identification("Quercus alba", Some("species"), Some("Plantae"));
    identifications::upsert(&db.pool, &before).await.unwrap();
    identifications::upsert(&db.pool, &identification("Quercus alba", None, None))
        .await
        .unwrap();

    let (_, rank, kingdom, _) = row(&db.pool).await;
    assert_eq!((rank, kingdom), (None, None));
    db.drop().await;
}

#[tokio::test]
async fn rename_requeues_taxon_resolution() {
    let Some(db) = common::scratch().await else {
        return;
    };
    identifications::upsert(&db.pool, &identification("Quercus rubra", None, None))
        .await
        .unwrap();
    resolve(&db.pool, 2880539).await;
    identifications::upsert(&db.pool, &identification("Quercus alba", None, None))
        .await
        .unwrap();

    let (name, _, _, key) = row(&db.pool).await;
    assert_eq!(name, "Quercus alba");
    assert_eq!(key, None, "the old taxon's key must not survive a rename");
    db.drop().await;
}

#[tokio::test]
async fn edit_keeping_name_and_kingdom_keeps_resolved_key() {
    let Some(db) = common::scratch().await else {
        return;
    };
    let resolved = identification("Quercus alba", None, Some("Plantae"));
    identifications::upsert(&db.pool, &resolved).await.unwrap();
    resolve(&db.pool, 2879737).await;
    let edited = identification("Quercus alba", Some("species"), Some("Plantae"));
    identifications::upsert(&db.pool, &edited).await.unwrap();

    let (_, rank, _, key) = row(&db.pool).await;
    assert_eq!(rank.as_deref(), Some("species"));
    assert_eq!(key, Some(2879737), "unrelated edits keep the resolved key");
    db.drop().await;
}
