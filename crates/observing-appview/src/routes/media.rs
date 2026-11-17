//! In-process media (blob/thumb) handlers backed by [`crate::media::MediaCache`].
//!
//! URL surface preserved from the previous external `observing-media-proxy`:
//!   * `GET /media/blob/{did}/{cid}`  — full image
//!   * `GET /media/thumb/{did}/{cid}` — JPEG thumbnail, at most
//!     [`crate::media::thumb::THUMB_MAX_EDGE`] px on its long edge
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
use tracing::{debug, error, warn};
use utoipa::ToSchema;

use crate::error::ErrorResponse;
use crate::media::thumb::{make_thumbnail, thumb_cache_cid, THUMB_CONTENT_TYPE};
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
/// A JPEG of the blob at most 600 px on its long edge, turned upright by the
/// original's EXIF orientation. Generated on first request and cached.
/// Blobs that can't be decoded as JPEG, PNG or WebP (HEIC, GIF, ...) come
/// back unchanged, with the content type the PDS reported. Responses are
/// immutable and safe to cache forever.
#[utoipa::path(
    get,
    path = "/media/thumb/{did}/{cid}",
    operation_id = "get_media_thumb",
    tag = "media",
    params(("did" = String, Path, description = "DID of the account that owns the blob"), ("cid" = String, Path, description = "CID of the blob")),
    responses(
        (status = 200, description = "A JPEG thumbnail at most 600 px on its long edge; the original bytes and content type if the blob isn't a JPEG, PNG or WebP image", content_type = "image/jpeg"),
        (status = 400, description = "Invalid DID", body = ErrorResponse),
        (status = 404, description = "The blob could not be fetched", body = ErrorResponse),
    )
)]
pub async fn get_thumb(
    State(state): State<AppState>,
    Path((did, cid)): Path<(String, String)>,
) -> Response {
    serve_thumb(&state.media, &did, &cid).await
}

async fn serve_blob(media: &MediaCache, did_str: &str, cid: &str) -> Response {
    let did = match Did::new_owned(did_str) {
        Ok(d) => d,
        Err(e) => return invalid_did(did_str, &e),
    };
    match fetch_and_cache(media, &did, cid).await {
        Ok((data, content_type, from_cache)) => media_response(data, &content_type, from_cache),
        Err(e) => {
            warn!(did = %did, cid = %cid, error = %e, "Failed to fetch blob");
            blob_not_found()
        }
    }
}

async fn serve_thumb(media: &MediaCache, did_str: &str, cid: &str) -> Response {
    let did = match Did::new_owned(did_str) {
        Ok(d) => d,
        Err(e) => return invalid_did(did_str, &e),
    };
    match fetch_thumbnail(media, &did, cid).await {
        Ok((data, content_type, from_cache)) => media_response(data, &content_type, from_cache),
        Err(e) => {
            warn!(did = %did, cid = %cid, error = %e, "Failed to fetch blob for thumbnail");
            blob_not_found()
        }
    }
}

fn invalid_did(did_str: &str, e: &dyn std::fmt::Display) -> Response {
    warn!(did = %did_str, error = %e, "Rejecting blob request with invalid DID");
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: format!("Invalid DID: {e}"),
        }),
    )
        .into_response()
}

fn media_response(data: Vec<u8>, content_type: &str, from_cache: bool) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        // Keyed by CID, so the bytes for a URL never change.
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header("X-Cache", if from_cache { "HIT" } else { "MISS" })
        .body(Body::from(data))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn blob_not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "Blob not found".to_string(),
        }),
    )
        .into_response()
}

/// Fetch a blob's thumbnail, generating and caching it on a miss.
///
/// The thumbnail lives in the same [`MediaCache`] as the originals, under
/// [`thumb_cache_cid`]. The bool is whether the thumbnail itself was cached.
/// A blob that can't be decoded is returned as-is (and not stored again).
pub(crate) async fn fetch_thumbnail(
    media: &MediaCache,
    did: &Did,
    cid: &str,
) -> Result<(Vec<u8>, String, bool), Box<dyn std::error::Error + Send + Sync>> {
    let did_str = did.as_str();
    let thumb_cid = thumb_cache_cid(cid);

    if let Some((data, content_type)) = media.cache.get(did_str, &thumb_cid).await {
        return Ok((data, content_type, true));
    }

    let (original, content_type, _) = fetch_and_cache(media, did, cid).await?;

    let (original, thumb) = {
        let _permit = media.thumb_permits.acquire().await?;
        tokio::task::spawn_blocking(move || {
            let thumb = make_thumbnail(&original);
            (original, thumb)
        })
        .await?
    };

    match thumb {
        Ok(thumb) => {
            if let Err(e) = media
                .cache
                .put(did_str, &thumb_cid, &thumb, THUMB_CONTENT_TYPE)
                .await
            {
                warn!(did = %did, cid = %cid, error = %e, "Failed to cache thumbnail");
            }
            Ok((thumb, THUMB_CONTENT_TYPE.to_string(), false))
        }
        Err(e) => {
            debug!(did = %did, cid = %cid, content_type = %content_type, error = %e,
                "Can't thumbnail blob; serving the original");
            Ok((original, content_type, false))
        }
    }
}

/// Fetch a blob, using cache if available; populate the cache on miss.
pub(crate) async fn fetch_and_cache(
    media: &MediaCache,
    did: &Did,
    cid: &str,
) -> Result<(Vec<u8>, String, bool), Box<dyn std::error::Error + Send + Sync>> {
    let did_str = did.as_str();

    if let Some((data, content_type)) = media.cache.get(did_str, cid).await {
        return Ok((data, content_type, true));
    }

    // `try_get_with` also coalesces concurrent misses for the same DID — a
    // feed page requests several of one account's images at once. Errors
    // aren't cached.
    let pds_url = media
        .pds_urls
        .try_get_with_by_ref(did_str, media.fetcher.resolve_pds_url(did))
        .await
        .map_err(|e| {
            error!(did = %did, error = %e, "Failed to resolve PDS URL");
            e
        })?;

    let (data, content_type) = match media.fetcher.fetch_blob(&pds_url, did_str, cid).await {
        Ok(blob) => blob,
        Err(e) => {
            error!(did = %did, cid = %cid, error = %e, "Failed to fetch blob from PDS");
            // The account may have moved PDS; resolve afresh next time.
            media.pds_urls.invalidate(did_str).await;
            return Err(e.into());
        }
    };

    if let Err(e) = media.cache.put(did_str, cid, &data, &content_type).await {
        warn!(did = %did, cid = %cid, error = %e, "Failed to cache blob");
        // Continue even if caching fails
    }

    Ok((data, content_type, false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::thumb::tests::test_jpeg;
    use file_blob_cache::BlobCache;

    const DID: &str = "did:plc:thumbtest";
    const CID: &str = "bafkreithumbtest";

    /// A media cache in a temp dir, with `original` already cached under
    /// [`DID`]/[`CID`] so no PDS is contacted.
    async fn media_with(original: &[u8], content_type: &str) -> (MediaCache, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let cache = BlobCache::new(dir.path().to_path_buf(), 64 * 1024 * 1024, 3600);
        cache.init().await.unwrap();
        cache.put(DID, CID, original, content_type).await.unwrap();
        (MediaCache::new(cache), dir)
    }

    async fn body_bytes(resp: Response) -> Vec<u8> {
        axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec()
    }

    #[tokio::test]
    async fn thumb_is_generated_then_served_from_cache() {
        let original = test_jpeg(2400, 1600, None);
        let (media, _dir) = media_with(&original, "image/jpeg").await;

        let resp = serve_thumb(&media, DID, CID).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers()[header::CONTENT_TYPE], "image/jpeg");
        assert_eq!(resp.headers()["X-Cache"], "MISS");
        assert_eq!(
            resp.headers()[header::CACHE_CONTROL],
            "public, max-age=31536000, immutable"
        );
        let first = body_bytes(resp).await;
        assert!(first.len() < original.len());
        let img = image::load_from_memory(&first).unwrap();
        assert_eq!((img.width(), img.height()), (600, 400));

        // Stored alongside the original, which is untouched.
        let (cached, ct) = media.cache.get(DID, &thumb_cache_cid(CID)).await.unwrap();
        assert_eq!(
            (cached.as_slice(), ct.as_str()),
            (first.as_slice(), "image/jpeg")
        );
        assert_eq!(media.cache.get(DID, CID).await.unwrap().0, original);

        let resp = serve_thumb(&media, DID, CID).await;
        assert_eq!(resp.headers()["X-Cache"], "HIT");
        assert_eq!(body_bytes(resp).await, first);
    }

    #[tokio::test]
    async fn blob_still_returns_the_original() {
        let original = test_jpeg(2400, 1600, None);
        let (media, _dir) = media_with(&original, "image/jpeg").await;
        let _ = serve_thumb(&media, DID, CID).await;

        let resp = serve_blob(&media, DID, CID).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(body_bytes(resp).await, original);
    }

    #[tokio::test]
    async fn undecodable_blob_falls_back_to_the_original() {
        let original = b"\0\0\0\x18ftypheic not really".to_vec();
        let (media, _dir) = media_with(&original, "image/heic").await;

        let resp = serve_thumb(&media, DID, CID).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers()[header::CONTENT_TYPE], "image/heic");
        assert_eq!(body_bytes(resp).await, original);
        assert!(media.cache.get(DID, &thumb_cache_cid(CID)).await.is_none());
    }

    #[tokio::test]
    async fn invalid_did_is_rejected() {
        let (media, _dir) = media_with(b"x", "image/jpeg").await;
        let resp = serve_thumb(&media, "not-a-did", CID).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
