//! HTTP server for taxonomy service endpoints

use crate::gbif::GbifClient;
use crate::types::HealthResponse;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing::info;

/// Shared state for the HTTP server
pub struct ServerState {
    pub client: GbifClient,
    pub started_at: DateTime<Utc>,
}

impl ServerState {
    pub fn new(client: GbifClient) -> Self {
        Self {
            client,
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

/// Search query parameters
#[derive(Deserialize)]
pub struct SearchQuery {
    q: String,
    #[serde(default = "default_limit")]
    limit: u32,
}

fn default_limit() -> u32 {
    10
}

/// Validate query parameters
#[derive(Deserialize)]
pub struct ValidateQuery {
    name: String,
}

/// Taxon query parameters (for get by name)
#[derive(Deserialize)]
pub struct TaxonQuery {
    #[serde(default)]
    kingdom: Option<String>,
}

/// Create the HTTP router
pub fn create_router(state: SharedState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/search", get(search))
        .route("/validate", get(validate))
        .route("/taxon/{id}", get(get_taxon))
        .route("/taxon/{id}/children", get(get_children))
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
    let cache_stats = state.client.cache_stats();
    let uptime_secs = (Utc::now() - state.started_at).num_seconds() as u64;

    Json(HealthResponse {
        status: "ok".to_string(),
        uptime_secs,
        cache: cache_stats,
    })
}

/// Search for taxa
async fn search(
    State(state): State<SharedState>,
    Query(params): Query<SearchQuery>,
) -> Response {
    match state.client.search(&params.q, params.limit).await {
        Ok(results) => Json(results).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "Search failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Search failed".to_string(),
                }),
            )
                .into_response()
        }
    }
}

/// Validate a scientific name
async fn validate(
    State(state): State<SharedState>,
    Query(params): Query<ValidateQuery>,
) -> Response {
    match state.client.validate(&params.name).await {
        Ok(result) => Json(result).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "Validation failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Validation failed".to_string(),
                }),
            )
                .into_response()
        }
    }
}

/// Get taxon by ID or name
async fn get_taxon(
    State(state): State<SharedState>,
    Path(id_or_name): Path<String>,
    Query(params): Query<TaxonQuery>,
) -> Response {
    // Check if this looks like a GBIF ID (gbif:NNN or just numeric)
    let is_id = id_or_name.starts_with("gbif:")
        || id_or_name.parse::<u64>().is_ok();

    let result = if is_id {
        state.client.get_by_id(&id_or_name).await
    } else {
        state
            .client
            .get_by_name(&id_or_name, params.kingdom.as_deref())
            .await
    };

    match result {
        Ok(Some(taxon)) => Json(taxon).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Taxon not found".to_string(),
            }),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "Get taxon failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to fetch taxon".to_string(),
                }),
            )
                .into_response()
        }
    }
}

/// Get children of a taxon
async fn get_children(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Response {
    match state.client.get_children(&id, 20).await {
        Ok(children) => Json(children).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "Get children failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Failed to fetch children".to_string(),
                }),
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    fn create_test_state() -> SharedState {
        let client = GbifClient::new();
        Arc::new(ServerState::new(client))
    }

    #[tokio::test]
    async fn test_health_endpoint() {
        let state = create_test_state();
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
    }

    #[tokio::test]
    async fn test_search_missing_query() {
        let state = create_test_state();
        let router = create_router(state);

        let response = router
            .oneshot(Request::builder().uri("/search").body(Body::empty()).unwrap())
            .await
            .unwrap();

        // Missing required 'q' parameter should return 400
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_validate_missing_name() {
        let state = create_test_state();
        let router = create_router(state);

        let response = router
            .oneshot(Request::builder().uri("/validate").body(Body::empty()).unwrap())
            .await
            .unwrap();

        // Missing required 'name' parameter should return 400
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
