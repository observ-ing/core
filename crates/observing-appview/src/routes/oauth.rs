use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::{error, info};
use utoipa::{IntoParams, ToSchema};

use crate::error::{AppError, ErrorResponse};
use crate::responses::SuccessResponse;
use crate::state::AppState;

const SESSION_MAX_AGE_SECS: i64 = 14 * 24 * 60 * 60;

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct LoginParams {
    /// The user's atproto handle, e.g. `alice.bsky.social`.
    #[param(required = true, value_type = String)]
    handle: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct LoginResponse {
    /// Authorization URL on the user's PDS to send the browser to.
    url: String,
}

/// Start signing in.
///
/// Returns the authorization URL to send the user's browser to. After the user
/// approves, their PDS redirects back to `/oauth/callback`, which sets the
/// session cookie.
#[utoipa::path(
    get,
    path = "/oauth/login",
    operation_id = "oauth_login",
    tag = "auth",
    params(LoginParams),
    responses(
        (status = 200, description = "Where to send the browser", body = LoginResponse),
        (status = 400, description = "Missing or invalid handle, or the login could not be started", body = ErrorResponse),
    )
)]
pub async fn login(
    State(state): State<AppState>,
    Query(params): Query<LoginParams>,
) -> Result<Json<LoginResponse>, AppError> {
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
            error!(
                error = %e,
                "OAuth authorize failed (in local dev, an empty PUBLIC_URL can \
                 produce an invalid redirect_uri and trigger a PDS 400)"
            );
            AppError::BadRequest(format!("Could not initiate login: {e}"))
        })?;

    Ok(Json(LoginResponse { url }))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CallbackParams {
    code: String,
    state: String,
    iss: Option<String>,
}

/// Finish signing in.
///
/// The OAuth redirect target: completes the flow, sets the session cookie,
/// and redirects to the app. Not called directly.
#[utoipa::path(
    get,
    path = "/oauth/callback",
    operation_id = "oauth_callback",
    tag = "auth",
    params(CallbackParams),
    responses(
        (status = 303, description = "Signed in; the `session_did` cookie is set"),
        (status = 500, description = "The authorization could not be completed", content_type = "text/plain"),
    )
)]
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

                    // SameSite=None lets the cookie be sent on cross-site
                    // requests, which is required when the Capacitor mobile
                    // app (origin https://localhost) calls the appview at
                    // observ.ing. Browsers require Secure for SameSite=None,
                    // so we only set both in production (HTTPS). In local
                    // dev we omit both — the browser then treats the cookie
                    // as default Lax, which is fine for same-origin use.
                    let attrs = if state.public_url.is_some() {
                        "; Secure; SameSite=None"
                    } else {
                        ""
                    };
                    let cookie = format!(
                        "session_did={}; HttpOnly; Path=/; Max-Age={}{}",
                        did_str, SESSION_MAX_AGE_SECS, attrs,
                    );
                    (
                        [(axum::http::header::SET_COOKIE, cookie)],
                        Redirect::to("/?just-authed=1"),
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

/// Sign out.
///
/// Clears the session cookie.
#[utoipa::path(
    post,
    path = "/oauth/logout",
    operation_id = "oauth_logout",
    tag = "auth",
    responses((status = 200, description = "Signed out", body = SuccessResponse))
)]
pub async fn logout(cookies: axum_extra::extract::CookieJar) -> Response {
    let did = cookies.get("session_did").map(|c| c.value().to_string());
    if let Some(ref did) = did {
        info!(did = %did, "Logout");
    }

    // Clear the cookie
    let cookie = "session_did=; HttpOnly; Path=/; Max-Age=0";
    (
        [(axum::http::header::SET_COOKIE, cookie)],
        Json(SuccessResponse { success: true }),
    )
        .into_response()
}

/// OAuth client metadata.
///
/// The client metadata document that atproto authorization servers fetch to
/// identify this app.
#[utoipa::path(
    get,
    path = "/oauth/client-metadata.json",
    operation_id = "get_oauth_client_metadata",
    tag = "auth",
    responses(
        (status = 200, description = "The client metadata", body = Object),
        (status = 404, description = "Not served in local development", content_type = "text/plain"),
    )
)]
pub async fn client_metadata(State(state): State<AppState>) -> Response {
    let Some(ref public_url) = state.public_url else {
        return (StatusCode::NOT_FOUND, "Not available in development mode").into_response();
    };

    Json(json!({
        "client_id": format!("{public_url}/oauth/client-metadata.json"),
        "client_name": "Observ.ing",
        "client_uri": public_url,
        "redirect_uris": [format!("{public_url}/oauth/callback")],
        "scope": "atproto transition:generic",
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "web",
        "dpop_bound_access_tokens": true
    }))
    .into_response()
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    did: String,
    handle: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct MeResponse {
    /// `null` when not signed in or the session has expired.
    user: Option<UserInfo>,
}

/// Get the signed-in user.
#[utoipa::path(
    get,
    path = "/oauth/me",
    operation_id = "get_current_user",
    tag = "auth",
    security((), ("session" = [])),
    responses((status = 200, description = "The signed-in user, or `null`", body = MeResponse))
)]
pub async fn me(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
) -> Result<Json<MeResponse>, AppError> {
    let did = match cookies.get("session_did") {
        Some(c) => c.value().to_string(),
        None => return Ok(Json(MeResponse { user: None })),
    };

    let did_parsed = match atrium_api::types::string::Did::new(did.clone()) {
        Ok(d) => d,
        Err(_) => return Ok(Json(MeResponse { user: None })),
    };

    // Verify the OAuth session is still valid
    if let Err(e) = state.oauth_client.restore(&did_parsed).await {
        error!(error = %e, "Failed to restore session for /oauth/me");
        return Ok(Json(MeResponse { user: None }));
    }

    // Resolve profile via public API (independent of OAuth session health)
    let (handle, display_name, avatar) = match state.resolver.get_profile(&did).await {
        Some(profile) => (
            profile.handle.clone(),
            profile.display_name.clone(),
            profile.avatar.clone(),
        ),
        None => {
            // Fall back to DID document for handle (works even if Bluesky API is down).
            // The session_did cookie has already been validated as a Did above
            // (atrium's validator), so re-parsing through our newtype should
            // succeed; if it doesn't, just fall back to the raw string.
            let handle = match atproto_identity::Did::new_owned(&did) {
                Ok(parsed) => state
                    .resolver
                    .resolve_did(&parsed)
                    .await
                    .and_then(|r| r.handle)
                    .unwrap_or_else(|| did.clone()),
                Err(_) => did.clone(),
            };
            (handle, None, None)
        }
    };

    Ok(Json(MeResponse {
        user: Some(UserInfo {
            did,
            handle,
            display_name,
            avatar,
        }),
    }))
}
