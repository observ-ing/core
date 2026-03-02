use axum_extra::extract::CookieJar;
use serde_json::Value;
use sqlx::postgres::PgPool;

use crate::error::AppError;
use crate::state::{AgentType, OAuthClientType};

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
