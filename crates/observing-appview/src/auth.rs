use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum_extra::extract::CookieJar;
use sqlx::postgres::PgPool;

use crate::error::AppError;
use crate::state::AppState;

/// User information extracted from session
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub did: String,
}

/// Axum extractor that validates the session cookie and returns an [`AuthUser`].
///
/// Use this as a handler parameter to require authentication:
///
/// ```ignore
/// async fn my_handler(user: AuthUser, ...) -> Result<..., AppError> { ... }
/// ```
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let cookies = CookieJar::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::Unauthorized)?;
        require_auth(&state.pool, &cookies)
            .await
            .map_err(|_| AppError::Unauthorized)
    }
}

/// Extract session DID from cookie (used for optional auth in read endpoints)
pub fn session_did(cookies: &CookieJar) -> Option<String> {
    cookies.get("session_did").map(|c| c.value().to_string())
}

/// Validate session and return AuthUser (used for required auth in write endpoints)
pub async fn require_auth(pool: &PgPool, cookies: &CookieJar) -> Result<AuthUser, ()> {
    let did = session_did(cookies).ok_or(())?;

    // Verify session exists in database
    let session = observing_db::oauth::get_session(pool, &did)
        .await
        .ok()
        .flatten();
    if session.is_none() {
        return Err(());
    }

    Ok(AuthUser { did })
}
