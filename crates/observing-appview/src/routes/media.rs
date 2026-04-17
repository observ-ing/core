//! In-process media (blob/thumb) handlers backed by [`crate::media::MediaCache`].
//!
//! URL surface preserved from the previous external `observing-media-proxy`:
//!   * `GET /media/blob/{did}/{cid}`  — full image
//!   * `GET /media/thumb/{did}/{cid}` — thumbnail (currently same bytes)
//!   * `GET /media/health`            — cache stats / uptime
//!
//! The appview mounts these under `/media` so client URLs like
//! `/media/blob/{did}/{cid}` continue to resolve unchanged.

use atproto_blob_resolver::Did;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Json, Response},
};
use chrono::Utc;
use serde::Serialize;
use tracing::{error, warn};

use crate::media::MediaCache;
use crate::state::AppState;

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub uptime_secs: u64,
    pub cache: file_blob_cache::CacheStats,
}

/// `GET /media/health` — service liveness + cache stats.
pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let cache_stats = state.media.cache.stats().await;
    let uptime_secs = (Utc::now() - state.media.started_at).num_seconds().max(0) as u64;
    Json(HealthResponse {
        status: "ok",
        uptime_secs,
        cache: cache_stats,
    })
}

/// `GET /media/blob/{did}/{cid}` — full blob.
pub async fn get_blob(
    State(state): State<AppState>,
    Path((did, cid)): Path<(String, String)>,
) -> Response {
    serve_blob(&state.media, &did, &cid).await
}

/// `GET /media/thumb/{did}/{cid}` — thumbnail.
///
/// Currently returns the full blob, matching the previous service.
pub async fn get_thumb(
    State(state): State<AppState>,
    Path((did, cid)): Path<(String, String)>,
) -> Response {
    serve_blob(&state.media, &did, &cid).await
}

async fn serve_blob(media: &MediaCache, did_str: &str, cid: &str) -> Response {
    let did = match Did::parse(did_str) {
        Ok(d) => d,
        Err(e) => {
            warn!(did = %did_str, error = %e, "Rejecting blob request with invalid DID");
            return (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: format!("Invalid DID: {e}"),
                }),
            )
                .into_response();
        }
    };

    match fetch_and_cache(media, &did, cid).await {
        Ok((data, content_type, from_cache)) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
            .header("X-Cache", if from_cache { "HIT" } else { "MISS" })
            .body(Body::from(data))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
        Err(e) => {
            warn!(did = %did, cid = %cid, error = %e, "Failed to fetch blob");
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Blob not found".to_string(),
                }),
            )
                .into_response()
        }
    }
}

/// Fetch a blob, using cache if available; populate the cache on miss.
async fn fetch_and_cache(
    media: &MediaCache,
    did: &Did,
    cid: &str,
) -> Result<(Vec<u8>, String, bool), Box<dyn std::error::Error + Send + Sync>> {
    let did_str = did.as_str();

    if let Some((data, content_type)) = media.cache.get(did_str, cid).await {
        return Ok((data, content_type, true));
    }

    let pds_url = media.fetcher.resolve_pds_url(did).await.map_err(|e| {
        error!(did = %did, error = %e, "Failed to resolve PDS URL");
        e
    })?;

    let (data, content_type) = media
        .fetcher
        .fetch_blob(&pds_url, did_str, cid)
        .await
        .map_err(|e| {
            error!(did = %did, cid = %cid, error = %e, "Failed to fetch blob from PDS");
            e
        })?;

    if let Err(e) = media.cache.put(did_str, cid, &data, &content_type).await {
        warn!(did = %did, cid = %cid, error = %e, "Failed to cache blob");
        // Continue even if caching fails
    }

    Ok((data, content_type, false))
}
