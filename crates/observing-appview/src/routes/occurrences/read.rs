use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;

use crate::auth::session_did;
use crate::constants;
use crate::enrichment;
use crate::error::AppError;
use crate::responses::{
    BboxBounds, BboxMeta, BboxResponse, GeoJsonFeature, GeoJsonPoint, GeoJsonProperties,
    GeoJsonResponse, NearbyMeta, NearbyResponse, OccurrenceDetailResponse, OccurrenceListResponse,
};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct NearbyParams {
    lat: Option<f64>,
    lng: Option<f64>,
    radius: Option<f64>,
    limit: Option<i64>,
    offset: Option<i64>,
}

pub async fn get_nearby(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Query(params): Query<NearbyParams>,
) -> Result<Json<NearbyResponse>, AppError> {
    let lat = params
        .lat
        .ok_or_else(|| AppError::BadRequest("lat is required".into()))?;
    let lng = params
        .lng
        .ok_or_else(|| AppError::BadRequest("lng is required".into()))?;
    let radius = params.radius.unwrap_or(constants::DEFAULT_NEARBY_RADIUS);
    let limit = params
        .limit
        .unwrap_or(constants::DEFAULT_NEARBY_LIMIT)
        .min(constants::MAX_NEARBY_LIMIT);
    let offset = params.offset.unwrap_or(0);

    let rows = observing_db::occurrences::get_nearby(
        &state.pool,
        lat,
        lng,
        radius,
        limit,
        offset,
        &state.hidden_dids,
    )
    .await?;

    let viewer = session_did(&cookies);
    let occurrences = enrichment::enrich_occurrences(
        &state.pool,
        &state.resolver,
        &state.taxonomy,
        &rows,
        viewer.as_deref(),
    )
    .await;

    Ok(Json(NearbyResponse {
        meta: NearbyMeta {
            lat,
            lng,
            radius,
            limit,
            offset,
            count: occurrences.len(),
        },
        occurrences,
    }))
}

#[derive(Deserialize)]
pub struct FeedParams {
    limit: Option<i64>,
    cursor: Option<String>,
}

pub async fn get_feed(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Query(params): Query<FeedParams>,
) -> Result<Json<OccurrenceListResponse>, AppError> {
    let limit = params
        .limit
        .unwrap_or(constants::DEFAULT_FEED_LIMIT)
        .min(constants::MAX_FEED_LIMIT);

    let rows = observing_db::occurrences::get_feed(
        &state.pool,
        limit,
        params.cursor.as_deref(),
        &state.hidden_dids,
    )
    .await?;

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

    Ok(Json(OccurrenceListResponse {
        occurrences,
        cursor: next_cursor,
    }))
}

#[derive(Deserialize)]
pub struct BboxParams {
    #[serde(rename = "minLat")]
    min_lat: Option<f64>,
    #[serde(rename = "minLng")]
    min_lng: Option<f64>,
    #[serde(rename = "maxLat")]
    max_lat: Option<f64>,
    #[serde(rename = "maxLng")]
    max_lng: Option<f64>,
    limit: Option<i64>,
}

pub async fn get_bbox(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Query(params): Query<BboxParams>,
) -> Result<Json<BboxResponse>, AppError> {
    let min_lat = params
        .min_lat
        .ok_or_else(|| AppError::BadRequest("minLat is required".into()))?;
    let min_lng = params
        .min_lng
        .ok_or_else(|| AppError::BadRequest("minLng is required".into()))?;
    let max_lat = params
        .max_lat
        .ok_or_else(|| AppError::BadRequest("maxLat is required".into()))?;
    let max_lng = params
        .max_lng
        .ok_or_else(|| AppError::BadRequest("maxLng is required".into()))?;
    let limit = params.limit.unwrap_or(constants::DEFAULT_BBOX_LIMIT);

    let rows = observing_db::occurrences::get_by_bounding_box(
        &state.pool,
        min_lat,
        min_lng,
        max_lat,
        max_lng,
        limit,
        &state.hidden_dids,
    )
    .await?;

    let viewer = session_did(&cookies);
    let occurrences = enrichment::enrich_occurrences(
        &state.pool,
        &state.resolver,
        &state.taxonomy,
        &rows,
        viewer.as_deref(),
    )
    .await;

    Ok(Json(BboxResponse {
        meta: BboxMeta {
            bounds: BboxBounds {
                min_lat,
                min_lng,
                max_lat,
                max_lng,
            },
            count: occurrences.len(),
        },
        occurrences,
    }))
}

pub async fn get_geojson(
    State(state): State<AppState>,
    Query(params): Query<BboxParams>,
) -> Result<Json<GeoJsonResponse>, AppError> {
    let min_lat = params
        .min_lat
        .ok_or_else(|| AppError::BadRequest("minLat is required".into()))?;
    let min_lng = params
        .min_lng
        .ok_or_else(|| AppError::BadRequest("minLng is required".into()))?;
    let max_lat = params
        .max_lat
        .ok_or_else(|| AppError::BadRequest("maxLat is required".into()))?;
    let max_lng = params
        .max_lng
        .ok_or_else(|| AppError::BadRequest("maxLng is required".into()))?;

    let rows = observing_db::occurrences::get_by_bounding_box(
        &state.pool,
        min_lat,
        min_lng,
        max_lat,
        max_lng,
        constants::MAX_GEOJSON_LIMIT,
        &state.hidden_dids,
    )
    .await?;

    let features: Vec<GeoJsonFeature> = rows
        .iter()
        .map(|row| GeoJsonFeature {
            feature_type: "Feature",
            geometry: GeoJsonPoint {
                geometry_type: "Point",
                coordinates: [row.longitude, row.latitude],
            },
            properties: GeoJsonProperties {
                uri: row.uri.clone(),
                event_date: row.event_date.to_rfc3339(),
            },
        })
        .collect();

    Ok(Json(GeoJsonResponse {
        collection_type: "FeatureCollection",
        features,
    }))
}

pub async fn get_occurrence(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Path(uri): Path<String>,
) -> Result<Json<OccurrenceDetailResponse>, AppError> {
    let row = observing_db::occurrences::get(&state.pool, &uri)
        .await?
        .ok_or_else(|| AppError::NotFound("Occurrence not found".into()))?;

    let viewer = session_did(&cookies);
    let enriched = enrichment::enrich_occurrences(
        &state.pool,
        &state.resolver,
        &state.taxonomy,
        &[row],
        viewer.as_deref(),
    )
    .await;

    let occurrence = enriched
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Internal("Failed to enrich occurrence".into()))?;

    let identification_rows =
        observing_db::identifications::get_for_occurrence(&state.pool, &uri).await?;
    let identifications =
        enrichment::enrich_identifications(&state.resolver, &identification_rows).await;

    let comment_rows = observing_db::comments::get_for_occurrence(&state.pool, &uri).await?;
    let comments = enrichment::enrich_comments(&state.resolver, &comment_rows).await;

    Ok(Json(OccurrenceDetailResponse {
        occurrence,
        identifications,
        comments,
    }))
}
