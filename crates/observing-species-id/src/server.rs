//! HTTP server for species identification service

use crate::model::BioclipModel;
use crate::types::{HealthResponse, IdentifyRequest, IdentifyResponse};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing::{error, info};

/// Shared state for the HTTP server
pub struct ServerState {
    pub model: BioclipModel,
    pub started_at: DateTime<Utc>,
}

pub type SharedState = Arc<ServerState>;

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

/// Create the HTTP router
pub fn create_router(state: SharedState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/identify", post(identify))
        .layer(DefaultBodyLimit::max(20 * 1024 * 1024)) // 20MB for base64-encoded images
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
    let uptime_secs = (Utc::now() - state.started_at).num_seconds() as u64;

    Json(HealthResponse {
        status: "ok".to_string(),
        uptime_secs,
        model_version: state.model.version.clone(),
        species_count: state.model.species_count(),
    })
}

/// Species identification endpoint
async fn identify(State(state): State<SharedState>, Json(body): Json<IdentifyRequest>) -> Response {
    let start = std::time::Instant::now();

    // Decode base64 image
    let image_bytes =
        match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &body.image) {
            Ok(bytes) => bytes,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: format!("Invalid base64 image data: {}", e),
                    }),
                )
                    .into_response();
            }
        };

    // Run inference (blocking CPU work — spawn on blocking thread pool)
    let model = state.clone();
    let limit = body.limit.min(20); // Cap at 20 suggestions

    // Pass lat/lon through for geo-prior reranking. Both must be present for
    // it to take effect; a single coord alone is unusable and we log + drop.
    let lat_lon = match (body.latitude, body.longitude) {
        (Some(lat), Some(lon)) => Some((lat, lon)),
        (Some(_), None) | (None, Some(_)) => {
            info!(lat = ?body.latitude, lng = ?body.longitude, "Ignoring half-specified geo context");
            None
        }
        (None, None) => None,
    };

    let result =
        tokio::task::spawn_blocking(move || model.model.identify(&image_bytes, lat_lon, limit))
            .await;

    match result {
        Ok(Ok(suggestions)) => {
            let elapsed = start.elapsed();
            info!(
                suggestions = suggestions.len(),
                inference_ms = elapsed.as_millis(),
                "Species identification complete"
            );

            Json(IdentifyResponse {
                suggestions,
                model_version: state.model.version.clone(),
                inference_time_ms: elapsed.as_millis() as u64,
            })
            .into_response()
        }
        Ok(Err(e)) => {
            error!(error = %e, "Species identification failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Species identification failed".to_string(),
                }),
            )
                .into_response()
        }
        Err(e) => {
            error!(error = %e, "Blocking task panicked");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Internal error".to_string(),
                }),
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: full integration tests require the model files to be present.
    // These tests verify the server structure without model loading.

    #[test]
    fn test_error_response_serializes() {
        let err = ErrorResponse {
            error: "test".to_string(),
        };
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("test"));
    }
}
