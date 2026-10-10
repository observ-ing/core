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
use utoipa::ToSchema;

use crate::error::ErrorResponse;
use crate::media::MediaCache;
use crate::state::AppState;

#[derive(Serialize, ToSchema)]
#[schema(as = MediaHealthResponse)]
pub struct HealthResponse {
    #[schema(example = "ok")]
    pub status: &'static str,
    pub uptime_secs: u64,
    /// Blob cache counters: `entries`, `total_size` (bytes), `hits`, `misses`.
    #[schema(value_type = Object)]
    pub cache: file_blob_cache::CacheStats,
}

/// Media cache liveness and stats.
#[utoipa::path(
    get,
    path = "/media/health",
    operation_id = "media_health",
    tag = "media",
    responses((status = 200, description = "The media cache is up", body = HealthResponse))
)]
pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let cache_stats = state.media.cache.stats().await;
    let uptime_secs = (Utc::now() - state.media.started_at).num_seconds().max(0) as u64;
    Json(HealthResponse {
        status: "ok",
        uptime_secs,
        cache: cache_stats,
    })
}

/// Get an image blob.
///
/// Fetches the blob from the owner's PDS and caches it. Responses are
/// immutable and safe to cache forever.
#[utoipa::path(
    get,
    path = "/media/blob/{did}/{cid}",
    operation_id = "get_media_blob",
    tag = "media",
    params(("did" = String, Path, description = "DID of the account that owns the blob"), ("cid" = String, Path, description = "CID of the blob")),
    responses(
        (status = 200, description = "The blob bytes, with the content type the PDS reported", content_type = "application/octet-stream"),
        (status = 400, description = "Invalid DID", body = ErrorResponse),
        (status = 404, description = "The blob could not be fetched", body = ErrorResponse),
    )
)]
pub async fn get_blob(
    State(state): State<AppState>,
    Path((did, cid)): Path<(String, String)>,
) -> Response {
    serve_blob(&state.media, &did, &cid).await
}

/// Get an image thumbnail.
///
/// Currently returns the full blob, matching the previous service.
#[utoipa::path(
    get,
    path = "/media/thumb/{did}/{cid}",
    operation_id = "get_media_thumb",
    tag = "media",
    params(("did" = String, Path, description = "DID of the account that owns the blob"), ("cid" = String, Path, description = "CID of the blob")),
    responses(
        (status = 200, description = "The image bytes", content_type = "application/octet-stream"),
        (status = 400, description = "Invalid DID", body = ErrorResponse),
        (status = 404, description = "The blob could not be fetched", body = ErrorResponse),
    )
)]
pub async fn get_thumb(
    State(state): State<AppState>,
    Path((did, cid)): Path<(String, String)>,
) -> Response {
    serve_blob(&state.media, &did, &cid).await
}

async fn serve_blob(media: &MediaCache, did_str: &str, cid: &str) -> Response {
    let did = match Did::new_owned(did_str) {
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
