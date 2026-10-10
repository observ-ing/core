use axum::{
    body::Bytes,
    extract::State,
    http::header,
    response::{IntoResponse, Response},
};
use tracing::warn;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::heic::ConvertError;
use crate::state::AppState;

/// POST /api/media/heic-to-jpeg
///
/// Takes the raw bytes of a HEIC/HEIF photo and returns it as a JPEG, for
/// browsers that can't decode HEIC themselves. Called at import time so the
/// preview, EXIF extraction and species ID all see a JPEG. Authenticated like
/// species ID: it burns real CPU per request.
pub async fn heic_to_jpeg(
    State(state): State<AppState>,
    _user: AuthUser,
    body: Bytes,
) -> Result<Response, AppError> {
    match state.heic.to_jpeg(&body).await {
        Ok(jpeg) => Ok((
            [
                (header::CONTENT_TYPE, "image/jpeg"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            jpeg,
        )
            .into_response()),
        Err(ConvertError::NotHeif) => Err(AppError::BadRequest("Not a HEIC/HEIF image".into())),
        Err(ConvertError::Unavailable) => Err(AppError::ServiceUnavailable(
            "HEIC conversion is not available".into(),
        )),
        Err(ConvertError::Decode(msg)) => {
            warn!(error = %msg, bytes = body.len(), "HEIC decode failed");
            Err(AppError::BadRequest(
                "Could not read this HEIC image".into(),
            ))
        }
        Err(e @ ConvertError::Internal(_)) => Err(AppError::Internal(e.to_string())),
    }
}
