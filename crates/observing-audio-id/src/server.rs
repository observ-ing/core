//! HTTP server for the audio identification service.

use crate::model::PerchModel;
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

pub struct ServerState {
    pub model: PerchModel,
    pub started_at: DateTime<Utc>,
}

pub type SharedState = Arc<ServerState>;

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

pub fn create_router(state: SharedState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/identify", post(identify))
        // Audio clips are larger than images — bump the body limit to 50MB
        // so a 30-second wav at CD quality (~5MB) plus base64 overhead
        // (~33%) fits comfortably.
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

pub async fn start_server(state: SharedState, port: u16) -> std::io::Result<()> {
    let router = create_router(state);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    info!("Starting HTTP server on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await
}

async fn health(State(state): State<SharedState>) -> Json<HealthResponse> {
    let uptime_secs = (Utc::now() - state.started_at).num_seconds() as u64;
    Json(HealthResponse {
        status: "ok".to_string(),
        uptime_secs,
        model_version: state.model.version.clone(),
        species_count: state.model.species_count(),
    })
}

async fn identify(State(state): State<SharedState>, Json(body): Json<IdentifyRequest>) -> Response {
    let start = std::time::Instant::now();

    let audio_bytes =
        match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &body.audio) {
            Ok(b) => b,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: format!("Invalid base64 audio data: {}", e),
                    }),
                )
                    .into_response();
            }
        };

    let state_for_blocking = state.clone();
    let limit = body.limit.min(20);
    let lat_lon = parse_lat_lon(&body);

    let result = tokio::task::spawn_blocking(move || {
        state_for_blocking
            .model
            .identify(&audio_bytes, lat_lon, limit)
    })
    .await;

    match result {
        Ok(Ok((suggestions, clip_duration_secs))) => {
            let elapsed = start.elapsed();
            info!(
                suggestions = suggestions.len(),
                inference_ms = elapsed.as_millis(),
                clip_duration_secs,
                "Audio identification complete"
            );
            Json(IdentifyResponse {
                suggestions,
                model_version: state.model.version.clone(),
                inference_time_ms: elapsed.as_millis() as u64,
                clip_duration_secs,
            })
            .into_response()
        }
        Ok(Err(e)) => {
            error!(error = %e, "Audio identification failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Audio identification failed".to_string(),
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
