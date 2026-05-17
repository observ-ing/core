use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::responses::SuccessResponse;
use crate::state::AppState;
use crate::validation::validate_license;

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct UserPreferencesResponse {
    #[ts(type = "string | null")]
    pub default_license: Option<String>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct UpdatePreferencesRequest {
    /// Pass `null` to clear the user's saved default.
    #[serde(default)]
    #[ts(type = "string | null")]
    pub default_license: Option<String>,
}

pub async fn get_preferences(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<UserPreferencesResponse>, AppError> {
    let row = observing_db::user_preferences::get(&state.pool, &user.did).await?;
    Ok(Json(UserPreferencesResponse {
        default_license: row.and_then(|r| r.default_license),
    }))
}

pub async fn update_preferences(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<UpdatePreferencesRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    if let Some(ref license) = body.default_license {
        validate_license(license)?;
    }

    observing_db::user_preferences::upsert(&state.pool, &user.did, body.default_license.as_deref())
        .await?;

    Ok(Json(SuccessResponse { success: true }))
}
