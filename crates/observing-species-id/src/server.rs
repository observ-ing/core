//! HTTP server for species identification service

use crate::detector::OrganismDetector;
use crate::model::BioclipModel;
use crate::types::{
    DetectRequest, DetectResponse, HealthResponse, IdentifyRequest, IdentifyResponse,
};
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
    /// Organism detector for the prototype `/detect` endpoint; `None` when
    /// its model files aren't present.
    pub detector: Option<OrganismDetector>,
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
        .route("/detect", post(detect))
        .layer(DefaultBodyLimit::max(20 * 1024 * 1024)) // 20MB for base64-encoded images
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Start the HTTP server
pub async fn start_server(state: SharedState, port: u16) -> std::io::Result<()> {
    observing_bootstrap::serve(create_router(state), port).await
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
    let lat_lon = parse_lat_lon(&body);

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

/// Organism detection endpoint (prototype): boxes around the living things
/// in a photo, for the user to pick one to identify. Independent of
/// `/identify`.
async fn detect(State(state): State<SharedState>, Json(body): Json<DetectRequest>) -> Response {
    let start = std::time::Instant::now();

    let Some(version) = state.detector.as_ref().map(|d| d.version.clone()) else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                error: "Organism detector is not loaded".to_string(),
            }),
        )
            .into_response();
    };

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

    let min_score = if body.min_score.is_finite() {
        body.min_score.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let limit = body.limit.min(50);
    let state_for_task = state.clone();
    let result = tokio::task::spawn_blocking(move || {
        state_for_task
            .detector
            .as_ref()
            .expect("checked above")
            .detect(&image_bytes, min_score, limit)
    })
    .await;

    match result {
        Ok(Ok(detections)) => {
            let elapsed = start.elapsed();
            info!(
                detections = detections.len(),
                inference_ms = elapsed.as_millis(),
                "Organism detection complete"
            );
            Json(DetectResponse {
                detections,
                model_version: version,
                inference_time_ms: elapsed.as_millis() as u64,
            })
            .into_response()
        }
        Ok(Err(crate::error::SpeciesIdError::Image(e))) => (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("Invalid image: {}", e),
            }),
        )
            .into_response(),
        Ok(Err(e)) => {
            error!(error = %e, "Organism detection failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Organism detection failed".to_string(),
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

/// Extract the lat/lon pair from the request, or `None` if either side is
/// missing. A single coordinate is unusable for a geo-prior — we log the
/// half-specified case so it's visible in production, but treat it as
/// "no location" rather than erroring the request.
fn parse_lat_lon(body: &IdentifyRequest) -> Option<(f64, f64)> {
    match (body.latitude, body.longitude) {
        (Some(lat), Some(lon)) => Some((lat, lon)),
        (Some(_), None) | (None, Some(_)) => {
            info!(
                lat = ?body.latitude,
                lng = ?body.longitude,
                "Ignoring half-specified geo context"
            );
            None
        }
        (None, None) => None,
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

    fn req(lat: Option<f64>, lon: Option<f64>) -> IdentifyRequest {
        IdentifyRequest {
            image: String::new(),
            latitude: lat,
            longitude: lon,
            limit: 5,
        }
    }

    #[test]
    fn parse_lat_lon_both_present() {
        assert_eq!(parse_lat_lon(&req(Some(1.0), Some(2.0))), Some((1.0, 2.0)));
    }

    #[test]
    fn parse_lat_lon_missing_either_returns_none() {
        assert_eq!(parse_lat_lon(&req(Some(1.0), None)), None);
        assert_eq!(parse_lat_lon(&req(None, Some(2.0))), None);
        assert_eq!(parse_lat_lon(&req(None, None)), None);
    }
}
