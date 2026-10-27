//! Per-user preferences: an update sets the fields it names and leaves the
//! rest alone, so a client that doesn't know a preference can't clear it.

use crate::common;

use observing_db::user_preferences::{self, PreferencesUpdate};

const ALICE: &str = "did:plc:alice";

#[tokio::test]
async fn an_update_leaves_the_preferences_it_omits_alone() {
    let Some(db) = common::scratch().await else {
        return;
    };

    let license = PreferencesUpdate {
        default_license: Some(Some("CC0-1.0")),
        ..Default::default()
    };
    user_preferences::upsert(&db.pool, ALICE, &license)
        .await
        .unwrap();
    let basemap = PreferencesUpdate {
        basemap: Some(Some("topo")),
        ..Default::default()
    };
    user_preferences::upsert(&db.pool, ALICE, &basemap)
        .await
        .unwrap();

    let row = user_preferences::get(&db.pool, ALICE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.basemap.as_deref(), Some("topo"));
    assert_eq!(row.default_license.as_deref(), Some("CC0-1.0"));

    db.drop().await;
}

#[tokio::test]
async fn an_update_clears_a_preference_set_to_none() {
    let Some(db) = common::scratch().await else {
        return;
    };

    let set = PreferencesUpdate {
        default_license: Some(Some("CC0-1.0")),
        basemap: Some(Some("topo")),
    };
    user_preferences::upsert(&db.pool, ALICE, &set)
        .await
        .unwrap();
    let clear = PreferencesUpdate {
        default_license: Some(None),
        ..Default::default()
    };
    user_preferences::upsert(&db.pool, ALICE, &clear)
        .await
        .unwrap();

    let row = user_preferences::get(&db.pool, ALICE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.default_license, None);
    assert_eq!(row.basemap.as_deref(), Some("topo"));

    db.drop().await;
}
