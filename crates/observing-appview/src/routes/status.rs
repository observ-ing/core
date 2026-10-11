use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use tracing::error;

use crate::error::ErrorResponse;
use crate::service_status::ServiceStatusResponse;
use crate::state::AppState;

/// Status of the production services.
///
/// Reports whether each service is awake or asleep (scaled to zero), how many
/// instances it's running, and whether the database is up. Public, and read
/// from Cloud Monitoring rather than by calling the services, so checking
/// never wakes anything. Cached for a minute.
#[utoipa::path(
    get,
    path = "/api/status",
    operation_id = "get_service_status",
    tag = "meta",
    responses(
        (status = 200, description = "Status of each service", body = ServiceStatusResponse),
        (status = 502, description = "Cloud Monitoring couldn't be read", body = ErrorResponse),
        (status = 503, description = "Service status isn't configured (e.g. local dev)", body = ErrorResponse),
    )
)]
pub async fn get_status(State(state): State<AppState>) -> Response {
    let Some(client) = &state.service_status else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                error: "Service status is not configured".into(),
            }),
        )
            .into_response();
    };

    match client.status().await {
        Ok(status) => Json(status).into_response(),
        Err(e) => {
            error!(error = %e, "Failed to read service status from Cloud Monitoring");
            (
                StatusCode::BAD_GATEWAY,
                Json(ErrorResponse {
                    error: "Couldn't read service status".into(),
                }),
            )
                .into_response()
        }
    }
}
