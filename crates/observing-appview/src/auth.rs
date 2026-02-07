use axum_extra::extract::CookieJar;
use sqlx::postgres::PgPool;

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
