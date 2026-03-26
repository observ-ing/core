use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;

use crate::auth::AuthUser;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyRequest {
    /// Base64-encoded image data
    image: String,
    #[serde(default)]
    latitude: Option<f64>,
    #[serde(default)]
    longitude: Option<f64>,
    #[serde(default)]
    limit: Option<usize>,
}

/// POST /api/species-id
///
/// Proxies to the species identification service.
/// Requires authentication to prevent abuse.
pub async fn identify(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(body): Json<IdentifyRequest>,
) -> impl IntoResponse {
    let client = match &state.species_id {
        Some(c) => c,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": "Species identification service not configured"
                })),
            )
                .into_response();
        }
    };

    match client
        .identify(&body.image, body.latitude, body.longitude, body.limit)
        .await
    {
        Some(response) => Json(serde_json::json!({
            "suggestions": response.suggestions,
            "modelVersion": response.model_version,
            "inferenceTimeMs": response.inference_time_ms,
        }))
        .into_response(),
        None => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({
                "error": "Species identification failed"
            })),
        )
            .into_response(),
    }
}
