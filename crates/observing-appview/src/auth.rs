use std::str::FromStr;

use axum_extra::extract::CookieJar;
use jacquard_common::types::string::{AtUri, Cid};
use observing_lexicons::com_atproto::repo::strong_ref::StrongRef;
use sqlx::postgres::PgPool;

use crate::error::AppError;

/// User information extracted from session
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub did: String,
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

/// Build a `StrongRef` from raw URI and CID strings, returning a user-facing
/// error when either value fails to parse.
pub fn build_strong_ref(uri: &str, cid: &str) -> Result<StrongRef<'static>, AppError> {
    Ok(StrongRef::new()
        .uri(AtUri::from_str(uri).map_err(|_| AppError::BadRequest("Invalid AT URI".into()))?)
        .cid(Cid::from_str(cid).map_err(|_| AppError::BadRequest("Invalid CID".into()))?)
        .build())
}
