use axum::extract::{Path, Query, State};
use axum::Json;
use observing_db::types::{ProfileFeedOptions, ProfileFeedType};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::enrichment;
use crate::error::AppError;
use crate::state::AppState;

fn session_did(cookies: &axum_extra::extract::CookieJar) -> Option<String> {
    cookies.get("session_did").map(|c| c.value().to_string())
}

#[derive(Deserialize)]
pub struct ProfileFeedParams {
    limit: Option<i64>,
    cursor: Option<String>,
    #[serde(rename = "type")]
    feed_type: Option<String>,
}

pub async fn get_profile_feed(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Path(did): Path<String>,
    Query(params): Query<ProfileFeedParams>,
) -> Result<Json<Value>, AppError> {
    let limit = params.limit.unwrap_or(20).min(100);

    let feed_type = match params.feed_type.as_deref() {
        Some("observations") => ProfileFeedType::Observations,
        Some("identifications") => ProfileFeedType::Identifications,
        _ => ProfileFeedType::All,
    };

    let options = ProfileFeedOptions {
        limit: Some(limit),
        cursor: params.cursor,
        feed_type: Some(feed_type),
    };

    let result = observing_db::feeds::get_profile_feed(&state.pool, &did, &options).await?;

    let viewer = session_did(&cookies);
    let occurrences = enrichment::enrich_occurrences(
        &state.pool,
        &state.resolver,
        &state.taxonomy,
        &result.occurrences,
        viewer.as_deref(),
    )
    .await;

    let identifications =
        enrichment::enrich_identifications(&state.resolver, &result.identifications).await;

    // Resolve profile for the DID
    let profile = state.resolver.get_profile(&did).await;

    let next_cursor = occurrences
        .last()
        .map(|o| o.created_at.clone())
        .or_else(|| {
            result
                .identifications
                .last()
                .map(|i| i.date_identified.to_string())
        });

    Ok(Json(json!({
        "profile": {
            "did": did,
            "handle": profile.as_ref().map(|p| p.handle.as_str()),
            "displayName": profile.as_ref().and_then(|p| p.display_name.as_deref()),
            "avatar": profile.as_ref().and_then(|p| p.avatar.as_deref()),
        },
        "counts": {
            "occurrences": result.counts.observations,
            "identifications": result.counts.identifications,
            "species": result.counts.species,
        },
        "occurrences": occurrences,
        "identifications": identifications,
        "cursor": next_cursor,
    })))
}
