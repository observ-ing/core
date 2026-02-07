use axum::extract::{Query, State};
use axum::Json;
use observing_db::types::{ExploreFeedOptions, HomeFeedOptions};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::enrichment;
use crate::error::AppError;
use crate::state::AppState;

fn session_did(cookies: &axum_extra::extract::CookieJar) -> Option<String> {
    cookies.get("session_did").map(|c| c.value().to_string())
}

#[derive(Deserialize)]
pub struct ExploreParams {
    limit: Option<i64>,
    cursor: Option<String>,
    taxon: Option<String>,
    kingdom: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
    radius: Option<f64>,
    #[serde(rename = "startDate")]
    start_date: Option<String>,
    #[serde(rename = "endDate")]
    end_date: Option<String>,
}

pub async fn get_explore(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Query(params): Query<ExploreParams>,
) -> Result<Json<Value>, AppError> {
    let limit = params.limit.unwrap_or(20).min(100);

    let options = ExploreFeedOptions {
        limit: Some(limit),
        cursor: params.cursor,
        taxon: params.taxon.clone(),
        kingdom: params.kingdom.clone(),
        lat: params.lat,
        lng: params.lng,
        radius: params.radius,
        start_date: params.start_date.clone(),
        end_date: params.end_date.clone(),
    };

    let rows = observing_db::feeds::get_explore_feed(&state.pool, &options).await?;

    let viewer = session_did(&cookies);
    let occurrences = enrichment::enrich_occurrences(
        &state.pool,
        &state.resolver,
        &state.taxonomy,
        &rows,
        viewer.as_deref(),
    )
    .await;

    let next_cursor = occurrences.last().map(|o| o.created_at.clone());

    Ok(Json(json!({
        "occurrences": occurrences,
        "cursor": next_cursor,
        "meta": {
            "filters": {
                "taxon": params.taxon,
                "kingdom": params.kingdom,
                "lat": params.lat,
                "lng": params.lng,
                "radius": params.radius,
                "startDate": params.start_date,
                "endDate": params.end_date,
            }
        }
    })))
}

#[derive(Deserialize)]
pub struct HomeParams {
    limit: Option<i64>,
    cursor: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
    #[serde(rename = "nearbyRadius")]
    nearby_radius: Option<f64>,
}

pub async fn get_home(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Query(params): Query<HomeParams>,
) -> Result<Json<Value>, AppError> {
    let viewer = session_did(&cookies).ok_or(AppError::Unauthorized)?;
    let limit = params.limit.unwrap_or(20).min(100);

    // Get followed DIDs
    let followed_dids = state.resolver.get_follows(&viewer).await;
    let total_follows = followed_dids.len();

    let options = HomeFeedOptions {
        limit: Some(limit),
        cursor: params.cursor,
        lat: params.lat,
        lng: params.lng,
        nearby_radius: params.nearby_radius,
    };

    let result = observing_db::feeds::get_home_feed(&state.pool, &followed_dids, &options).await?;

    let occurrences = enrichment::enrich_occurrences(
        &state.pool,
        &state.resolver,
        &state.taxonomy,
        &result.rows,
        Some(&viewer),
    )
    .await;

    let next_cursor = occurrences.last().map(|o| o.created_at.clone());

    Ok(Json(json!({
        "occurrences": occurrences,
        "cursor": next_cursor,
        "meta": {
            "followedCount": result.followed_count,
            "nearbyCount": result.nearby_count,
            "totalFollows": total_follows,
        }
    })))
}
