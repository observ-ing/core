//! HTTP server for media proxy endpoints
//!
//! Provides /health, /blob/:did/:cid, and /thumb/:did/:cid endpoints.

use crate::cache::BlobCache;
use crate::proxy::BlobFetcher;
use crate::types::HealthResponse;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};

/// Shared state for the HTTP server
pub struct ServerState {
    pub cache: BlobCache,
    pub fetcher: BlobFetcher,
    pub started_at: DateTime<Utc>,
}

impl ServerState {
    pub fn new(cache: BlobCache, fetcher: BlobFetcher) -> Self {
        Self {
            cache,
            fetcher,
            started_at: Utc::now(),
        }
    }
}

pub type SharedState = Arc<ServerState>;

/// Error response
#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

/// Create the HTTP router
pub fn create_router(state: SharedState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/blob/{did}/{cid}", get(get_blob))
        .route("/thumb/{did}/{cid}", get(get_thumb))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Start the HTTP server
pub async fn start_server(state: SharedState, port: u16) -> std::io::Result<()> {
    let router = create_router(state);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    info!("Starting HTTP server on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await
}

/// Health check endpoint
async fn health(State(state): State<SharedState>) -> Json<HealthResponse> {
    let cache_stats = state.cache.stats().await;
    let uptime_secs = (Utc::now() - state.started_at).num_seconds() as u64;

    Json(HealthResponse {
        status: "ok".to_string(),
        uptime_secs,
        cache: cache_stats,
    })
}

/// Get a blob by DID and CID
async fn get_blob(
    State(state): State<SharedState>,
    Path((did, cid)): Path<(String, String)>,
) -> Response {
    match fetch_and_cache_blob(&state, &did, &cid).await {
        Ok((data, content_type, from_cache)) => {
            let cache_header = if from_cache { "HIT" } else { "MISS" };

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CACHE_CONTROL, "public, max-age=86400")
                .header("X-Cache", cache_header)
                .body(Body::from(data))
                .unwrap()
        }
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

/// Get a thumbnail by DID and CID (currently just returns the full blob)
async fn get_thumb(
    State(state): State<SharedState>,
    Path((did, cid)): Path<(String, String)>,
) -> Response {
    // For now, just return the full blob
    // Future: integrate image resizing
    match fetch_and_cache_blob(&state, &did, &cid).await {
        Ok((data, content_type, from_cache)) => {
            let cache_header = if from_cache { "HIT" } else { "MISS" };

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CACHE_CONTROL, "public, max-age=86400")
                .header("X-Cache", cache_header)
                .body(Body::from(data))
                .unwrap()
        }
        Err(e) => {
            warn!(did = %did, cid = %cid, error = %e, "Failed to fetch thumbnail");
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

/// Fetch a blob, using cache if available
async fn fetch_and_cache_blob(
    state: &ServerState,
    did: &str,
    cid: &str,
) -> Result<(Vec<u8>, String, bool), Box<dyn std::error::Error + Send + Sync>> {
    // Check cache first
    if let Some((data, content_type)) = state.cache.get(did, cid).await {
        return Ok((data, content_type, true));
    }

    // Resolve PDS URL
    let pds_url = state.fetcher.resolve_pds_url(did).await.map_err(|e| {
        error!(did = %did, error = %e, "Failed to resolve PDS URL");
        e
    })?;

    // Fetch from PDS
    let (data, content_type) = state
        .fetcher
        .fetch_blob(&pds_url, did, cid)
        .await
        .map_err(|e| {
            error!(did = %did, cid = %cid, error = %e, "Failed to fetch blob from PDS");
            e
        })?;

    // Cache the blob
    if let Err(e) = state.cache.put(did, cid, &data, &content_type).await {
        warn!(did = %did, cid = %cid, error = %e, "Failed to cache blob");
        // Continue even if caching fails
    }

    Ok((data, content_type, false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use std::path::PathBuf;
    use tempfile::tempdir;
    use tower::ServiceExt;

    fn create_test_state(cache_dir: PathBuf) -> SharedState {
        let cache = BlobCache::new(cache_dir, 1024 * 1024, 3600);
        let fetcher = BlobFetcher::new();
        Arc::new(ServerState::new(cache, fetcher))
    }

    #[tokio::test]
    async fn test_health_endpoint() {
        let dir = tempdir().unwrap();
        let state = create_test_state(dir.path().to_path_buf());
        state.cache.init().await.unwrap();
        let router = create_router(state);

        let response = router
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(json["status"], "ok");
        assert!(json["uptime_secs"].as_u64().is_some());
        assert!(json["cache"]["entries"].as_u64().is_some());
    }

    #[tokio::test]
    async fn test_blob_endpoint_not_found() {
        let dir = tempdir().unwrap();
        let state = create_test_state(dir.path().to_path_buf());
        state.cache.init().await.unwrap();
        let router = create_router(state);

        // This will fail because the DID doesn't exist
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/blob/did:plc:nonexistent/bafytest")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_thumb_endpoint_not_found() {
        let dir = tempdir().unwrap();
        let state = create_test_state(dir.path().to_path_buf());
        state.cache.init().await.unwrap();
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/thumb/did:plc:nonexistent/bafytest")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_server_state_new() {
        let dir = tempdir().unwrap();
        let cache = BlobCache::new(dir.path().to_path_buf(), 1024, 3600);
        let fetcher = BlobFetcher::new();
        let state = ServerState::new(cache, fetcher);

        // started_at should be close to now
        let diff = (Utc::now() - state.started_at).num_seconds();
        assert!(diff >= 0 && diff < 5);
    }
}
