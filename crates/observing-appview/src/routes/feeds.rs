use axum::extract::{Query, State};
use axum::Json;
use observing_db::quality::QualitySelection;
use observing_db::types::{ExploreFeedOptions, HomeFeedOptions};
use serde::Deserialize;
use utoipa::IntoParams;

use crate::auth::session_did;
use crate::constants;
use crate::enrichment;
use crate::error::{AppError, ErrorResponse};
use crate::responses::{ExploreFeedResponse, ExploreFilters, ExploreMeta, HomeFeedResponse};
use crate::state::AppState;

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ExploreParams {
    /// Page size. Values above 100 are clamped.
    #[param(default = json!(constants::DEFAULT_FEED_LIMIT))]
    limit: Option<i64>,
    /// `cursor` from the previous page.
    cursor: Option<String>,
    /// Only occurrences whose scientific name starts with this text
    /// (case-insensitive).
    taxon: Option<String>,
    /// Only occurrences whose community identification is in this kingdom.
    kingdom: Option<String>,
    /// Only occurrences whose event date overlaps the window starting on this
    /// day (`YYYY-MM-DD`). Undated occurrences never match a date filter.
    #[serde(rename = "startDate")]
    start_date: Option<String>,
    /// Only occurrences whose event date overlaps the window ending on this
    /// day, inclusive (`YYYY-MM-DD`).
    #[serde(rename = "endDate")]
    end_date: Option<String>,
    /// Comma-separated data-quality criteria every returned occurrence must
    /// meet: `HAS_DATE`, `HAS_LOCATION`, `PRECISE_LOCATION`, `HAS_MEDIA`,
    /// `HAS_CONSENSUS_ID`, or `complete` for all of them.
    #[param(value_type = Option<String>, example = "HAS_MEDIA,HAS_CONSENSUS_ID")]
    quality: Option<QualitySelection>,
}

/// Explore feed.
///
/// All public occurrences, newest first, with optional filters.
#[utoipa::path(
    get,
    path = "/api/feeds/explore",
    operation_id = "get_explore_feed",
    tag = "feeds",
    params(ExploreParams),
    security((), ("session" = [])),
    responses(
        (status = 200, description = "A page of occurrences", body = ExploreFeedResponse),
        (status = 400, description = "Unknown `quality` criterion"),
    )
)]
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
        start_date: params.start_date.clone(),
        end_date: params.end_date.clone(),
        quality: params.quality.unwrap_or_default(),
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
        occurrences.last().map(|o| o.feed_cursor())
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
                start_date: params.start_date,
                end_date: params.end_date,
            },
        },
    }))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct HomeParams {
    /// Page size. Values above 100 are clamped.
    #[param(default = json!(constants::DEFAULT_FEED_LIMIT))]
    limit: Option<i64>,
    /// `cursor` from the previous page.
    cursor: Option<String>,
    /// Data-quality criteria, as for the explore feed.
    #[param(value_type = Option<String>, example = "complete")]
    quality: Option<QualitySelection>,
}

/// Home feed.
///
/// All public occurrences, newest first, for a signed-in viewer. Unlike the
/// explore feed it takes no taxon, kingdom, or date filters.
#[utoipa::path(
    get,
    path = "/api/feeds/home",
    operation_id = "get_home_feed",
    tag = "feeds",
    params(HomeParams),
    security(("session" = [])),
    responses(
        (status = 200, description = "A page of occurrences", body = HomeFeedResponse),
        (status = 400, description = "Unknown `quality` criterion"),
        (status = 401, description = "Not signed in", body = ErrorResponse),
    )
)]
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
        quality: params.quality.unwrap_or_default(),
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
        occurrences.last().map(|o| o.feed_cursor())
    } else {
        None
    };

    Ok(Json(HomeFeedResponse {
        occurrences,
        cursor: next_cursor,
    }))
}
