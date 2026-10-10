use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utoipa::ToSchema;

use crate::auth::AuthUser;
use crate::error::{AppError, ErrorResponse};
use crate::responses::SuccessResponse;
use crate::state::AppState;
use crate::validation::{validate_basemap, validate_license};

#[derive(Serialize, TS, ToSchema)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct UserPreferencesResponse {
    #[ts(type = "string | null")]
    pub default_license: Option<String>,
    #[ts(type = "string | null")]
    pub basemap: Option<String>,
}

#[derive(Deserialize, TS, ToSchema)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct UpdatePreferencesRequest {
    /// Pass `null` to clear the user's saved default.
    #[serde(default)]
    #[ts(type = "string | null")]
    pub default_license: Option<String>,
    /// Map basemap id ("outdoor" | "topo" | "streets" | "satellite"). Pass
    /// `null` to clear.
    #[serde(default)]
    #[ts(type = "string | null")]
    pub basemap: Option<String>,
}

/// Get the viewer's preferences.
#[utoipa::path(
    get,
    path = "/api/user/preferences",
    tag = "preferences",
    security(("session" = [])),
    responses(
        (status = 200, description = "The viewer's preferences; unset values are null", body = UserPreferencesResponse),
        (status = 401, description = "Not signed in", body = ErrorResponse),
    )
)]
pub async fn get_preferences(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<UserPreferencesResponse>, AppError> {
    let row = observing_db::user_preferences::get(&state.pool, &user.did).await?;
    Ok(Json(UserPreferencesResponse {
        default_license: row.as_ref().and_then(|r| r.default_license.clone()),
        basemap: row.and_then(|r| r.basemap),
    }))
}

/// Update the viewer's preferences.
///
/// Replaces both preferences: an omitted field is cleared, same as `null`.
#[utoipa::path(
    put,
    path = "/api/user/preferences",
    tag = "preferences",
    request_body = UpdatePreferencesRequest,
    security(("session" = [])),
    responses(
        (status = 200, description = "The preferences were saved", body = SuccessResponse),
        (status = 400, description = "Unknown license or basemap", body = ErrorResponse),
        (status = 401, description = "Not signed in", body = ErrorResponse),
    )
)]
pub async fn update_preferences(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<UpdatePreferencesRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    let default_license = match body.default_license {
        Some(ref license) => Some(validate_license(license)?),
        None => None,
    };
    if let Some(ref basemap) = body.basemap {
        validate_basemap(basemap)?;
    }

    observing_db::user_preferences::upsert(
        &state.pool,
        &user.did,
        default_license,
        body.basemap.as_deref(),
    )
    .await?;

    Ok(Json(SuccessResponse { success: true }))
}
