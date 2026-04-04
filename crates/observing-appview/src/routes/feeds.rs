use axum::extract::{Query, State};
use axum::Json;
use observing_db::types::{ExploreFeedOptions, HomeFeedOptions};
use serde::Deserialize;

use crate::auth::session_did;
use crate::constants;
use crate::enrichment;
use crate::error::AppError;
use crate::responses::{ExploreFeedResponse, ExploreFilters, ExploreMeta, HomeFeedResponse};
use crate::state::AppState;

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
) -> Result<Json<ExploreFeedResponse>, AppError> {
    let limit = params
        .limit
        .unwrap_or(constants::DEFAULT_FEED_LIMIT)
        .min(constants::MAX_FEED_LIMIT);

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

    let rows =
        observing_db::feeds::get_explore_feed(&state.pool, &options, &state.hidden_dids).await?;

    let viewer = session_did(&cookies);
    let occurrences = enrichment::enrich_occurrences(
        &state.pool,
        &state.resolver,
        &state.taxonomy,
        &rows,
        viewer.as_deref(),
    )
    .await;

    let next_cursor = if occurrences.len() as i64 == limit {
        occurrences.last().map(|o| o.created_at.clone())
    } else {
        None
    };

    Ok(Json(ExploreFeedResponse {
        occurrences,
        cursor: next_cursor,
        meta: ExploreMeta {
            filters: ExploreFilters {
                taxon: params.taxon,
                kingdom: params.kingdom,
                lat: params.lat,
                lng: params.lng,
                radius: params.radius,
                start_date: params.start_date,
                end_date: params.end_date,
            },
        },
    }))
}

#[derive(Deserialize)]
pub struct HomeParams {
    limit: Option<i64>,
    cursor: Option<String>,
}

pub async fn get_home(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Query(params): Query<HomeParams>,
) -> Result<Json<HomeFeedResponse>, AppError> {
    let viewer = session_did(&cookies).ok_or(AppError::Unauthorized)?;
    let limit = params
        .limit
        .unwrap_or(constants::DEFAULT_FEED_LIMIT)
        .min(constants::MAX_FEED_LIMIT);

    let options = HomeFeedOptions {
        limit: Some(limit),
        cursor: params.cursor,
    };

    let rows =
        observing_db::feeds::get_home_feed(&state.pool, &options, &state.hidden_dids).await?;

    let occurrences = enrichment::enrich_occurrences(
        &state.pool,
        &state.resolver,
        &state.taxonomy,
        &rows,
        Some(&viewer),
    )
    .await;

    let next_cursor = if occurrences.len() as i64 == limit {
        occurrences.last().map(|o| o.created_at.clone())
    } else {
        None
    };

    Ok(Json(HomeFeedResponse {
        occurrences,
        cursor: next_cursor,
    }))
}
