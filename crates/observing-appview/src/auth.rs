use std::str::FromStr;

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum_extra::extract::CookieJar;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::{AtUri, Cid};
use observing_lexicons::com_atproto::repo::strong_ref::StrongRef;
use serde_json::Value;
use sqlx::postgres::PgPool;

use crate::error::AppError;
use crate::state::{AgentType, AppState, OAuthClientType};

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

/// Build a `StrongRef` from raw URI and CID strings, returning a user-facing
/// error when either value fails to parse.
pub fn build_strong_ref(uri: &str, cid: &str) -> Result<StrongRef<'static>, AppError> {
    Ok(StrongRef::new()
        .uri(AtUri::from_str(uri).map_err(|_| AppError::BadRequest("Invalid AT URI".into()))?)
        .cid(Cid::from_str(cid).map_err(|_| AppError::BadRequest("Invalid CID".into()))?)
        .build())
}

/// Restore an OAuth session and return an AT Protocol agent for the given DID.
pub async fn require_agent(
    oauth_client: &OAuthClientType,
    did: &str,
) -> Result<(AgentType, atrium_api::types::string::Did), AppError> {
    let did_parsed = atrium_api::types::string::Did::new(did.to_string())
        .map_err(|e| AppError::Internal(format!("Invalid DID: {e}")))?;
    let session = oauth_client.restore(&did_parsed).await.map_err(|e| {
        tracing::warn!(error = %e, "Failed to restore OAuth session");
        AppError::Unauthorized
    })?;
    let agent = atrium_api::agent::Agent::new(session);
    Ok((agent, did_parsed))
}

/// Serialize a lexicon record to a [`serde_json::Value`] with the `$type` field set.
pub fn serialize_at_record<T: Collection + serde::Serialize>(
    record: &T,
) -> Result<Value, AppError> {
    let mut value = serde_json::to_value(record).map_err(|e| AppError::Internal(e.to_string()))?;
    value["$type"] = serde_json::json!(T::NSID);
    Ok(value)
}

/// Create an AT Protocol record via the PDS agent.
///
/// Handles NSID parsing, record serialization, and maps authentication errors
/// to `AppError::Unauthorized` and other errors to `AppError::Internal`.
pub async fn create_at_record(
    agent: &AgentType,
    did: atrium_api::types::string::Did,
    nsid: &str,
    record_value: Value,
) -> Result<atrium_api::com::atproto::repo::create_record::Output, AppError> {
    agent
        .api
        .com
        .atproto
        .repo
        .create_record(
            atrium_api::com::atproto::repo::create_record::InputData {
                collection: nsid
                    .parse()
                    .map_err(|e| AppError::Internal(format!("Invalid NSID: {e}")))?,
                record: serde_json::from_value(record_value)
                    .map_err(|e| AppError::Internal(format!("Failed to convert record: {e}")))?,
                repo: atrium_api::types::string::AtIdentifier::Did(did),
                rkey: None,
                swap_commit: None,
                validate: None,
            }
            .into(),
        )
        .await
        .map_err(|e| {
            if matches!(e, atrium_api::xrpc::Error::Authentication(_)) {
                tracing::warn!(
                    error = %e,
                    "AT Protocol authentication failed (session expired)"
                );
                AppError::Unauthorized
            } else {
                AppError::Internal(format!("Failed to create record: {e}"))
            }
        })
}
