use axum::extract::{Query, State};
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::{error, info};

use crate::error::AppError;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct LoginParams {
    handle: Option<String>,
}

/// GET /oauth/login?handle=alice.bsky.social
/// Returns JSON { url: "..." } for the frontend to redirect to.
pub async fn login(
    State(state): State<AppState>,
    Query(params): Query<LoginParams>,
) -> Result<Json<Value>, AppError> {
    let handle = params
        .handle
        .ok_or_else(|| AppError::BadRequest("Handle is required".into()))?;

    info!(handle = %handle, "OAuth login initiated");

    let handle = atrium_api::types::string::Handle::new(handle)
        .map_err(|e| AppError::BadRequest(format!("Invalid handle: {e}")))?;

    let url = state
        .oauth_client
        .authorize(
            &handle,
            atrium_oauth::AuthorizeOptions {
                scopes: vec![
                    atrium_oauth::Scope::Known(atrium_oauth::KnownScope::Atproto),
                    atrium_oauth::Scope::Known(atrium_oauth::KnownScope::TransitionGeneric),
                ],
                ..Default::default()
            },
        )
        .await
        .map_err(|e| {
            error!(error = %e, "OAuth authorize failed");
            AppError::BadRequest(format!("Could not initiate login: {e}"))
        })?;

    Ok(Json(json!({ "url": url })))
}

#[derive(Deserialize)]
pub struct CallbackParams {
    code: String,
    state: String,
    iss: Option<String>,
}

/// GET /oauth/callback?code=...&state=...&iss=...
/// Completes the OAuth flow, sets session_did cookie, and redirects to /.
pub async fn callback(
    State(state): State<AppState>,
    Query(params): Query<CallbackParams>,
) -> Response {
    info!("OAuth callback received");

    let callback_params = atrium_oauth::CallbackParams {
        code: params.code,
        state: Some(params.state),
        iss: params.iss,
    };

    match state.oauth_client.callback(callback_params).await {
        Ok((session, _)) => {
            let agent = atrium_api::agent::Agent::new(session);
            match agent.did().await {
                Some(did) => {
                    let did_str = did.to_string();
                    info!(did = %did_str, "OAuth callback successful");

                    // Set session_did cookie and redirect to /
                    let cookie = format!(
                        "session_did={}; HttpOnly; Path=/; Max-Age={}",
                        did_str,
                        14 * 24 * 60 * 60, // 14 days
                    );
                    (
                        [(axum::http::header::SET_COOKIE, cookie)],
                        Redirect::to("/"),
                    )
                        .into_response()
                }
                None => {
                    error!("OAuth callback: no DID in session");
                    (
                        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        "Authentication failed: no DID",
                    )
                        .into_response()
                }
            }
        }
        Err(e) => {
            error!(error = %e, "OAuth callback failed");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Authentication failed",
            )
                .into_response()
        }
    }
}

/// POST /oauth/logout
/// Clears session cookie and returns { success: true }.
pub async fn logout(cookies: axum_extra::extract::CookieJar) -> Response {
    let did = cookies.get("session_did").map(|c| c.value().to_string());
    if let Some(ref did) = did {
        info!(did = %did, "Logout");
    }

    // Clear the cookie
    let cookie = "session_did=; HttpOnly; Path=/; Max-Age=0";
    (
        [(axum::http::header::SET_COOKIE, cookie)],
        Json(json!({ "success": true })),
    )
        .into_response()
}

/// GET /oauth/me
/// Returns { user: { did, handle } } or { user: null }.
pub async fn me(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
) -> Result<Json<Value>, AppError> {
    let did = match cookies.get("session_did") {
        Some(c) => c.value().to_string(),
        None => return Ok(Json(json!({ "user": null }))),
    };

    // Try to restore the OAuth session to verify it's valid
    let did_parsed = match atrium_api::types::string::Did::new(did.clone()) {
        Ok(d) => d,
        Err(_) => return Ok(Json(json!({ "user": null }))),
    };

    match state.oauth_client.restore(&did_parsed).await {
        Ok(session) => {
            let agent = atrium_api::agent::Agent::new(session);
            // Try to get the user's handle from their profile
            let handle = match agent
                .api
                .app
                .bsky
                .actor
                .get_profile(
                    atrium_api::app::bsky::actor::get_profile::ParametersData {
                        actor: atrium_api::types::string::AtIdentifier::Did(did_parsed),
                    }
                    .into(),
                )
                .await
            {
                Ok(profile) => profile.handle.to_string(),
                Err(_) => did.clone(),
            };

            Ok(Json(json!({
                "user": {
                    "did": did,
                    "handle": handle,
                }
            })))
        }
        Err(e) => {
            error!(error = %e, "Failed to restore session for /oauth/me");
            Ok(Json(json!({ "user": null })))
        }
    }
}
