//! Per-user preferences: an update sets the fields it names and leaves the
//! rest alone, so a client that doesn't know a preference can't clear it.

use crate::common;

use observing_db::user_preferences::{self, PreferencesUpdate};

const ALICE: &str = "did:plc:alice";

#[tokio::test]
async fn crosspost_preferences_round_trip_and_clear() {
    let Some(db) = common::scratch().await else {
        return;
    };

    let set = PreferencesUpdate {
        crosspost_inaturalist: Some(Some(true)),
        crosspost_inaturalist_require_photos: Some(Some(false)),
        ..Default::default()
    };
    user_preferences::upsert(&db.pool, ALICE, &set)
        .await
        .unwrap();
    let row = user_preferences::get(&db.pool, ALICE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.crosspost_inaturalist, Some(true));
    assert_eq!(row.crosspost_inaturalist_require_photos, Some(false));

    let clear = PreferencesUpdate {
        crosspost_inaturalist: Some(None),
        crosspost_inaturalist_require_photos: Some(None),
        ..Default::default()
    };
    user_preferences::upsert(&db.pool, ALICE, &clear)
        .await
        .unwrap();
    let row = user_preferences::get(&db.pool, ALICE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.crosspost_inaturalist, None);
    assert_eq!(row.crosspost_inaturalist_require_photos, None);

    db.drop().await;
}

/// A client built before the crosspost preferences existed sends only the
/// license and basemap; saving those must not turn auto-posting off.
#[tokio::test]
async fn an_update_leaves_the_preferences_it_omits_alone() {
    let Some(db) = common::scratch().await else {
        return;
    };

    let auto_post = PreferencesUpdate {
        default_license: Some(Some("CC0-1.0")),
        crosspost_inaturalist: Some(Some(true)),
        ..Default::default()
    };
    user_preferences::upsert(&db.pool, ALICE, &auto_post)
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
    assert_eq!(row.crosspost_inaturalist, Some(true));

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
        ..Default::default()
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
