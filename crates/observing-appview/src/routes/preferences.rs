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
    /// Whether new observations are posted to iNaturalist by default. Null
    /// means the user never chose, which clients treat as off.
    #[ts(type = "boolean | null")]
    pub crosspost_inaturalist: Option<bool>,
    /// Whether that default applies only to observations with photos. Null
    /// means the user never chose, which clients treat as on.
    #[ts(type = "boolean | null")]
    pub crosspost_inaturalist_require_photos: Option<bool>,
}

/// Preferences to change. Omit a field to leave it as it is, or pass `null` to
/// clear it. Fields a client doesn't know about are then never touched, so an
/// older client can't clear a preference it predates.
#[derive(Deserialize, TS, ToSchema)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct UpdatePreferencesRequest {
    /// The user's default license for new observations.
    #[serde(default, with = "present")]
    #[ts(as = "Option<Option<String>>", optional)]
    #[schema(value_type = Option<String>)]
    pub default_license: Option<Option<String>>,
    /// Map basemap id ("outdoor" | "topo" | "streets" | "satellite").
    #[serde(default, with = "present")]
    #[ts(as = "Option<Option<String>>", optional)]
    #[schema(value_type = Option<String>)]
    pub basemap: Option<Option<String>>,
    /// Whether new observations are posted to iNaturalist by default.
    #[serde(default, with = "present")]
    #[ts(as = "Option<Option<bool>>", optional)]
    #[schema(value_type = Option<bool>)]
    pub crosspost_inaturalist: Option<Option<bool>>,
    /// Whether that default applies only to observations with photos.
    #[serde(default, with = "present")]
    #[ts(as = "Option<Option<bool>>", optional)]
    #[schema(value_type = Option<bool>)]
    pub crosspost_inaturalist_require_photos: Option<Option<bool>>,
}

/// A field that is present, even as `null`, is `Some`: `Some(None)` for
/// `null`, where an omitted one is `None` (from `#[serde(default)]`).
mod present {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        Option::<T>::deserialize(deserializer).map(Some)
    }
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
        basemap: row.as_ref().and_then(|r| r.basemap.clone()),
        crosspost_inaturalist: row.as_ref().and_then(|r| r.crosspost_inaturalist),
        crosspost_inaturalist_require_photos: row
            .as_ref()
            .and_then(|r| r.crosspost_inaturalist_require_photos),
    }))
}

/// Update the viewer's preferences.
///
/// Changes the fields given and leaves the rest as they are.
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
        Some(Some(ref license)) => Some(Some(validate_license(license)?)),
        Some(None) => Some(None),
        None => None,
    };
    if let Some(Some(ref basemap)) = body.basemap {
        validate_basemap(basemap)?;
    }

    let update = observing_db::user_preferences::PreferencesUpdate {
        default_license,
        basemap: body.basemap.as_ref().map(Option::as_deref),
        crosspost_inaturalist: body.crosspost_inaturalist,
        crosspost_inaturalist_require_photos: body.crosspost_inaturalist_require_photos,
    };
    observing_db::user_preferences::upsert(&state.pool, &user.did, &update).await?;

    Ok(Json(SuccessResponse { success: true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_omitted_preference_is_left_alone_and_a_null_one_cleared() {
        let body: UpdatePreferencesRequest =
            serde_json::from_str(r#"{"basemap": "topo", "defaultLicense": null}"#).unwrap();
        assert_eq!(body.basemap, Some(Some("topo".to_string())));
        assert_eq!(body.default_license, Some(None));
        assert_eq!(body.crosspost_inaturalist, None);
        assert_eq!(body.crosspost_inaturalist_require_photos, None);
    }
}
