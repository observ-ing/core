use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::auth::session_did;
use crate::constants;
use crate::enrichment;
use crate::error::{AppError, ErrorResponse};
use crate::responses::{
    BboxBounds, BboxMeta, BboxResponse, GeoJsonFeature, GeoJsonPoint, GeoJsonProperties,
    GeoJsonResponse, NearbyMeta, NearbyResponse, OccurrenceDetailResponse, OccurrenceListResponse,
};
use crate::state::AppState;

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct NearbyParams {
    /// Latitude of the search center, in decimal degrees.
    #[param(required = true, value_type = f64)]
    lat: Option<f64>,
    /// Longitude of the search center, in decimal degrees.
    #[param(required = true, value_type = f64)]
    lng: Option<f64>,
    /// Search radius in meters.
    #[param(default = json!(constants::DEFAULT_NEARBY_RADIUS))]
    radius: Option<f64>,
    /// Page size. Values above 1000 are clamped.
    #[param(default = json!(constants::DEFAULT_NEARBY_LIMIT))]
    limit: Option<i64>,
    /// Number of results to skip.
    #[param(default = 0)]
    offset: Option<i64>,
}

/// List occurrences near a point.
///
/// Ordered by distance from the given point.
#[utoipa::path(
    get,
    path = "/api/occurrences/nearby",
    operation_id = "get_nearby_occurrences",
    tag = "occurrences",
    params(NearbyParams),
    security((), ("session" = [])),
    responses(
        (status = 200, description = "Occurrences within the radius", body = NearbyResponse),
        (status = 400, description = "`lat` or `lng` missing", body = ErrorResponse),
    )
)]
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

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct FeedParams {
    /// Page size. Values above 100 are clamped.
    #[param(default = json!(constants::DEFAULT_FEED_LIMIT))]
    limit: Option<i64>,
    /// `cursor` from the previous page.
    cursor: Option<String>,
}

/// List recent occurrences.
///
/// Newest first, unfiltered. Pass the returned `cursor` to fetch the next page.
#[utoipa::path(
    get,
    path = "/api/occurrences/feed",
    operation_id = "get_occurrence_feed",
    tag = "occurrences",
    params(FeedParams),
    security((), ("session" = [])),
    responses(
        (status = 200, description = "A page of occurrences", body = OccurrenceListResponse),
    )
)]
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

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct BboxParams {
    /// Southern edge, in decimal degrees.
    #[serde(rename = "minLat")]
    #[param(required = true, value_type = f64)]
    min_lat: Option<f64>,
    /// Western edge, in decimal degrees.
    #[serde(rename = "minLng")]
    #[param(required = true, value_type = f64)]
    min_lng: Option<f64>,
    /// Northern edge, in decimal degrees.
    #[serde(rename = "maxLat")]
    #[param(required = true, value_type = f64)]
    max_lat: Option<f64>,
    /// Eastern edge, in decimal degrees.
    #[serde(rename = "maxLng")]
    #[param(required = true, value_type = f64)]
    max_lng: Option<f64>,
    /// Maximum number of occurrences to return. Ignored by the GeoJSON
    /// endpoint, which always returns up to 10000 points.
    #[param(default = json!(constants::DEFAULT_BBOX_LIMIT))]
    limit: Option<i64>,
}

/// List occurrences inside a bounding box.
#[utoipa::path(
    get,
    path = "/api/occurrences/bbox",
    operation_id = "get_occurrences_in_bbox",
    tag = "occurrences",
    params(BboxParams),
    security((), ("session" = [])),
    responses(
        (status = 200, description = "Occurrences inside the box", body = BboxResponse),
        (status = 400, description = "A bound is missing", body = ErrorResponse),
    )
)]
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

/// Occurrence points inside a bounding box, as GeoJSON.
///
/// A lightweight alternative to the bbox endpoint for map rendering: each
/// feature carries only the occurrence URI and event date.
#[utoipa::path(
    get,
    path = "/api/occurrences/geojson",
    operation_id = "get_occurrence_geojson",
    tag = "occurrences",
    params(BboxParams),
    responses(
        (status = 200, description = "A GeoJSON FeatureCollection of points", body = GeoJsonResponse),
        (status = 400, description = "A bound is missing", body = ErrorResponse),
    )
)]
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

    // Bbox query already excludes rows without `location` (the `&&`
    // operator returns NULL there), so an unwrap here would be safe —
    // but the row type is Option<f64>, so filter to be explicit and
    // skip any row whose coords are somehow missing.
    let features: Vec<GeoJsonFeature> = rows
        .iter()
        .filter_map(|row| {
            let (lng, lat) = (row.longitude?, row.latitude?);
            Some(GeoJsonFeature {
                feature_type: "Feature",
                geometry: GeoJsonPoint {
                    geometry_type: "Point",
                    coordinates: [lng, lat],
                },
                properties: GeoJsonProperties {
                    uri: row.uri.clone(),
                    event_date: row.event_date.clone(),
                },
            })
        })
        .collect();

    Ok(Json(GeoJsonResponse {
        collection_type: "FeatureCollection",
        features,
    }))
}

/// Get an occurrence with its identifications and comments.
#[utoipa::path(
    get,
    path = "/api/occurrences/{uri}",
    tag = "occurrences",
    params(("uri" = String, Path, description = "AT URI of the occurrence (`at://...`), percent-encoded")),
    security((), ("session" = [])),
    responses(
        (status = 200, description = "The occurrence", body = OccurrenceDetailResponse),
        (status = 404, description = "No such occurrence", body = ErrorResponse),
    )
)]
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
