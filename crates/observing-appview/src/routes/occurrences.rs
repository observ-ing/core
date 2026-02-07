use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::enrichment;
use crate::error::AppError;
use crate::state::AppState;

fn session_did(cookies: &axum_extra::extract::CookieJar) -> Option<String> {
    cookies.get("session_did").map(|c| c.value().to_string())
}

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
) -> Result<Json<Value>, AppError> {
    let lat = params
        .lat
        .ok_or_else(|| AppError::BadRequest("lat is required".into()))?;
    let lng = params
        .lng
        .ok_or_else(|| AppError::BadRequest("lng is required".into()))?;
    let radius = params.radius.unwrap_or(10000.0);
    let limit = params.limit.unwrap_or(100).min(1000);
    let offset = params.offset.unwrap_or(0);

    let rows =
        observing_db::occurrences::get_nearby(&state.pool, lat, lng, radius, limit, offset)
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

    Ok(Json(json!({
        "occurrences": occurrences,
        "meta": {
            "lat": lat,
            "lng": lng,
            "radius": radius,
            "limit": limit,
            "offset": offset,
            "count": occurrences.len(),
        }
    })))
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
) -> Result<Json<Value>, AppError> {
    let limit = params.limit.unwrap_or(20).min(100);

    let rows =
        observing_db::occurrences::get_feed(&state.pool, limit, params.cursor.as_deref()).await?;

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
    })))
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
) -> Result<Json<Value>, AppError> {
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
    let limit = params.limit.unwrap_or(1000);

    let rows = observing_db::occurrences::get_by_bounding_box(
        &state.pool, min_lat, min_lng, max_lat, max_lng, limit,
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

    Ok(Json(json!({
        "occurrences": occurrences,
        "meta": {
            "bounds": {
                "minLat": min_lat,
                "minLng": min_lng,
                "maxLat": max_lat,
                "maxLng": max_lng,
            },
            "count": occurrences.len(),
        }
    })))
}

pub async fn get_geojson(
    State(state): State<AppState>,
    Query(params): Query<BboxParams>,
) -> Result<Json<Value>, AppError> {
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
        &state.pool, min_lat, min_lng, max_lat, max_lng, 10000,
    )
    .await?;

    let features: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [row.longitude, row.latitude]
                },
                "properties": {
                    "uri": row.uri,
                    "scientificName": row.scientific_name,
                    "eventDate": row.event_date.to_rfc3339(),
                }
            })
        })
        .collect();

    Ok(Json(json!({
        "type": "FeatureCollection",
        "features": features,
    })))
}

/// Handles both GET /api/occurrences/{uri} and GET /api/occurrences/{uri}/observers
/// since axum catch-all wildcards don't allow sub-routes.
pub async fn get_occurrence_or_observers(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Path(full_path): Path<String>,
) -> Result<Json<Value>, AppError> {
    if let Some(uri) = full_path.strip_suffix("/observers") {
        return get_observers_inner(&state, uri).await;
    }

    get_occurrence_inner(&state, &cookies, &full_path).await
}

async fn get_occurrence_inner(
    state: &AppState,
    cookies: &axum_extra::extract::CookieJar,
    uri: &str,
) -> Result<Json<Value>, AppError> {
    let row = observing_db::occurrences::get(&state.pool, uri)
        .await?
        .ok_or_else(|| AppError::NotFound("Occurrence not found".into()))?;

    let viewer = session_did(cookies);
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
        observing_db::identifications::get_for_occurrence(&state.pool, uri).await?;
    let identifications =
        enrichment::enrich_identifications(&state.resolver, &identification_rows).await;

    let comment_rows = observing_db::comments::get_for_occurrence(&state.pool, uri).await?;
    let comments = enrichment::enrich_comments(&state.resolver, &comment_rows).await;

    Ok(Json(json!({
        "occurrence": occurrence,
        "identifications": identifications,
        "comments": comments,
    })))
}

async fn get_observers_inner(
    state: &AppState,
    uri: &str,
) -> Result<Json<Value>, AppError> {
    let observers = observing_db::observers::get_for_occurrence(&state.pool, uri).await?;

    let dids: Vec<String> = observers.iter().map(|o| o.did.clone()).collect();
    let profiles = state.resolver.get_profiles(&dids).await;

    let infos: Vec<Value> = observers
        .iter()
        .map(|o| {
            let p = profiles.get(&o.did);
            json!({
                "did": o.did,
                "role": o.role,
                "handle": p.map(|p| p.handle.as_str()),
                "displayName": p.and_then(|p| p.display_name.as_deref()),
                "avatar": p.and_then(|p| p.avatar.as_deref()),
                "addedAt": o.added_at.map(|t| t.to_rfc3339()),
            })
        })
        .collect();

    Ok(Json(json!({ "observers": infos })))
}


