use axum::extract::{Query, State};
use axum::http::header::SET_COOKIE;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{AppendHeaders, IntoResponse, Redirect, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::{error, info};
use utoipa::{IntoParams, ToSchema};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

use crate::auth::{self, LEGACY_SESSION_COOKIE, SESSION_COOKIE};
use crate::error::{AppError, ErrorResponse};
use crate::responses::SuccessResponse;
use crate::state::AppState;

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
/// `session` cookie.
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
    let url = authorize_url(&state, handle).await?;
    Ok(Json(LoginResponse { url }))
}

/// The authorization URL on `handle`'s PDS that starts an atproto OAuth flow
/// ending at `/oauth/callback`.
async fn authorize_url(state: &AppState, handle: String) -> Result<String, AppError> {
    let handle = atrium_api::types::string::Handle::new(handle)
        .map_err(|e| AppError::BadRequest(format!("Invalid handle: {e}")))?;

    state
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
        })
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CallbackParams {
    /// Absent when the authorization server answers with `error` instead.
    code: Option<String>,
    state: String,
    iss: Option<String>,
    /// RFC 6749 §4.1.2.1: why the authorization was not granted.
    error: Option<String>,
}

/// Finish signing in.
///
/// The OAuth redirect target: completes the flow, starts a session, sets the
/// `session` cookie to its opaque token, and redirects to the app. Not called
/// directly.
#[utoipa::path(
    get,
    path = "/oauth/callback",
    operation_id = "oauth_callback",
    tag = "auth",
    params(CallbackParams),
    responses(
        (status = 303, description = "Signed in; the `session` cookie is set"),
        (status = 500, description = "The authorization could not be completed", content_type = "text/plain"),
    )
)]
pub async fn callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<CallbackParams>,
) -> Response {
    info!("OAuth callback received");

    // An app's sign-in (started at /oauth/app/login in this browser) is handed
    // back to the app, not finished with a cookie.
    let app = pending_app_login(&headers).filter(|a| {
        a.oauth_state == params.state && state.app_redirect_uris.contains(&a.redirect_uri)
    });
    let secure = state.public_url.is_some();

    let code = match (params.code, params.error) {
        (Some(code), None) => code,
        (_, error) => {
            info!(error = ?error, "OAuth callback without a code");
            return match app {
                Some(app) => back_to_app(&app, &[("error", app_error(error.as_deref()))], secure),
                None => (StatusCode::BAD_REQUEST, "Authentication failed").into_response(),
            };
        }
    };

    let callback_params = atrium_oauth::CallbackParams {
        code,
        state: Some(params.state),
        iss: params.iss,
    };

    match state.oauth_client.callback(callback_params).await {
        Ok((session, _)) => {
            let agent = atrium_api::agent::Agent::new(session);
            match agent.did().await {
                Some(did) => {
                    let did_str = did.to_string();
                    info!(did = %did_str, app = app.is_some(), "OAuth callback successful");

                    if let Some(app) = app {
                        return match issue_app_code(&state, &did_str, &app.code_challenge).await {
                            Ok(code) => back_to_app(&app, &[("code", code.as_str())], secure),
                            Err(e) => {
                                error!(error = %e, "Failed to store app sign-in code");
                                back_to_app(&app, &[("error", "server_error")], secure)
                            }
                        };
                    }

                    let token = match auth::create_session(&state.pool, &did_str).await {
                        Ok(token) => token,
                        Err(e) => {
                            error!(error = %e, "Failed to store session");
                            return (StatusCode::INTERNAL_SERVER_ERROR, "Authentication failed")
                                .into_response();
                        }
                    };
                    (
                        AppendHeaders([
                            (SET_COOKIE, auth::session_cookie(&token, secure)),
                            (
                                SET_COOKIE,
                                auth::clear_cookie(LEGACY_SESSION_COOKIE, secure),
                            ),
                        ]),
                        Redirect::to("/?just-authed=1"),
                    )
                        .into_response()
                }
                None => {
                    error!("OAuth callback: no DID in session");
                    match app {
                        Some(app) => back_to_app(&app, &[("error", "server_error")], secure),
                        None => (
                            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                            "Authentication failed: no DID",
                        )
                            .into_response(),
                    }
                }
            }
        }
        Err(e) => {
            error!(error = %e, "OAuth callback failed");
            match app {
                Some(app) => back_to_app(&app, &[("error", "server_error")], secure),
                None => (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "Authentication failed",
                )
                    .into_response(),
            }
        }
    }
}

// --- App sign-in -----------------------------------------------------------
//
// A native app (or any client that can't hold the session cookie) signs in by
// opening `/oauth/app/login` in the system browser with a PKCE challenge
// (RFC 7636). The atproto OAuth flow runs as for the web; at the callback the
// appview redirects to the app's registered callback with a one-time code,
// which the app trades with its verifier at `/oauth/app/token` for a session
// token to send as `Authorization: Bearer`. The token never travels in a URL,
// and a code intercepted on its way to the app is useless without the verifier.

/// Carries an app's sign-in from `/oauth/app/login` to `/oauth/callback` in
/// the same browser.
const APP_LOGIN_COOKIE: &str = "app_login";
/// How long the browser has to finish signing in.
const APP_LOGIN_MAX_AGE_SECS: i64 = 600;
/// How long the app has to trade its code.
const APP_CODE_TTL_SECS: i64 = 120;

/// An app's sign-in in progress: where to hand it back, the app's own
/// `state`, its PKCE challenge, and the atproto OAuth `state` it rides on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct AppLogin {
    redirect_uri: String,
    state: String,
    code_challenge: String,
    oauth_state: String,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct AppLoginParams {
    /// The user's atproto handle, e.g. `alice.bsky.social`.
    handle: String,
    /// The app's callback; must be one the appview allows (`APP_REDIRECT_URIS`).
    redirect_uri: String,
    /// Returned to the app unchanged, so it can match the answer to its request.
    state: String,
    /// `BASE64URL(SHA256(code_verifier))`, without padding.
    code_challenge: String,
    /// Must be `S256`.
    code_challenge_method: String,
}

/// Start an app's sign-in.
///
/// Opened in the system browser. Runs the atproto OAuth flow, then redirects
/// to `redirect_uri` with `code` and `state` (or `error` and `state`).
#[utoipa::path(
    get,
    path = "/oauth/app/login",
    operation_id = "oauth_app_login",
    tag = "auth",
    params(AppLoginParams),
    responses(
        (status = 303, description = "To the user's authorization server"),
        (status = 400, description = "A callback the appview doesn't allow, a bad challenge or state, or an invalid handle", body = ErrorResponse),
    )
)]
pub async fn app_login(
    State(state): State<AppState>,
    Query(params): Query<AppLoginParams>,
) -> Result<Response, AppError> {
    if !state.app_redirect_uris.contains(&params.redirect_uri) {
        return Err(AppError::BadRequest(
            "This app isn't allowed to sign in here".into(),
        ));
    }
    if params.code_challenge_method != "S256" || !is_s256_challenge(&params.code_challenge) {
        return Err(AppError::BadRequest(
            "code_challenge must be an S256 PKCE challenge".into(),
        ));
    }
    if params.state.is_empty() || params.state.len() > 512 {
        return Err(AppError::BadRequest("state is required".into()));
    }
    info!(handle = %params.handle, redirect_uri = %params.redirect_uri, "App sign-in initiated");

    let url = authorize_url(&state, params.handle).await?;
    let oauth_state = url::Url::parse(&url)
        .ok()
        .and_then(|u| {
            u.query_pairs()
                .find(|(k, _)| k == "state")
                .map(|(_, v)| v.into_owned())
        })
        .ok_or_else(|| {
            error!("Authorization URL carries no state");
            AppError::BadRequest("Could not initiate login".into())
        })?;
    let app = AppLogin {
        redirect_uri: params.redirect_uri,
        state: params.state,
        code_challenge: params.code_challenge,
        oauth_state,
    };
    Ok((
        AppendHeaders([(
            SET_COOKIE,
            app_login_cookie(&app, state.public_url.is_some()),
        )]),
        Redirect::to(&url),
    )
        .into_response())
}

#[derive(Deserialize, ToSchema)]
pub struct AppTokenRequest {
    /// The code `/oauth/app/login` handed to the app's callback.
    code: String,
    /// The PKCE verifier whose S256 challenge started the sign-in.
    code_verifier: String,
}

#[derive(Serialize, ToSchema)]
pub struct AppTokenResponse {
    /// The session token: send it as `Authorization: Bearer <token>`.
    token: String,
    /// The DID it signs in as.
    did: String,
}

/// Finish an app's sign-in.
///
/// Trades a one-time code and its PKCE verifier for a session token. A code
/// works once, whether or not the verifier matches, and only for minutes.
#[utoipa::path(
    post,
    path = "/oauth/app/token",
    operation_id = "oauth_app_token",
    tag = "auth",
    request_body = AppTokenRequest,
    responses(
        (status = 200, description = "Signed in", body = AppTokenResponse),
        (status = 400, description = "An unknown, used or expired code, or a verifier that doesn't match", body = ErrorResponse),
    )
)]
pub async fn app_token(
    State(state): State<AppState>,
    Json(body): Json<AppTokenRequest>,
) -> Result<Json<AppTokenResponse>, AppError> {
    let invalid = || AppError::BadRequest("invalid_grant".into());
    let taken =
        observing_db::app_login_codes::take(&state.pool, &auth::hash_session_token(&body.code))
            .await
            .map_err(|e| AppError::Internal(format!("Failed to read sign-in code: {e}")))?
            .ok_or_else(invalid)?;
    if !verifier_answers(&body.code_verifier, &taken.code_challenge) {
        info!(did = %taken.did, "App sign-in: verifier doesn't match");
        return Err(invalid());
    }
    let token = auth::create_session(&state.pool, &taken.did)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to store session: {e}")))?;
    info!(did = %taken.did, "App sign-in finished");
    Ok(Json(AppTokenResponse {
        token,
        did: taken.did,
    }))
}

/// Store a one-time code for `did` and return it.
async fn issue_app_code(
    state: &AppState,
    did: &str,
    code_challenge: &str,
) -> Result<String, sqlx::Error> {
    let code = auth::new_session_token();
    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(APP_CODE_TTL_SECS);
    observing_db::app_login_codes::create(
        &state.pool,
        &auth::hash_session_token(&code),
        did,
        code_challenge,
        expires_at,
    )
    .await?;
    if let Err(e) = observing_db::app_login_codes::delete_expired(&state.pool).await {
        tracing::warn!(error = %e, "Failed to delete expired sign-in codes");
    }
    Ok(code)
}

/// Redirect to the app's callback with `params` and its `state`, clearing the
/// sign-in's cookie.
fn back_to_app(app: &AppLogin, params: &[(&str, &str)], secure: bool) -> Response {
    let location = app_callback_url(app, params);
    (
        AppendHeaders([(SET_COOKIE, app_login_clear_cookie(secure))]),
        Redirect::to(&location),
    )
        .into_response()
}

fn app_callback_url(app: &AppLogin, params: &[(&str, &str)]) -> String {
    match url::Url::parse(&app.redirect_uri) {
        Ok(mut url) => {
            {
                let mut q = url.query_pairs_mut();
                for (k, v) in params {
                    q.append_pair(k, v);
                }
                q.append_pair("state", &app.state);
            }
            url.to_string()
        }
        // Allowed callbacks are checked at /oauth/app/login; one that doesn't
        // parse can't be reached, so send the browser home.
        Err(_) => "/".to_string(),
    }
}

/// The error an app is told: a denial is the person's; anything else is ours.
fn app_error(error: Option<&str>) -> &'static str {
    match error {
        Some("access_denied") => "access_denied",
        _ => "server_error",
    }
}

fn app_login_cookie(app: &AppLogin, secure: bool) -> String {
    let value = URL_SAFE_NO_PAD.encode(serde_json::to_vec(app).expect("AppLogin serializes"));
    format!(
        "{APP_LOGIN_COOKIE}={value}; HttpOnly; Path=/oauth; Max-Age={APP_LOGIN_MAX_AGE_SECS}; SameSite=Lax{}",
        if secure { "; Secure" } else { "" }
    )
}

fn app_login_clear_cookie(secure: bool) -> String {
    format!(
        "{APP_LOGIN_COOKIE}=; HttpOnly; Path=/oauth; Max-Age=0; SameSite=Lax{}",
        if secure { "; Secure" } else { "" }
    )
}

/// The app sign-in this browser started, if any.
fn pending_app_login(headers: &HeaderMap) -> Option<AppLogin> {
    let value = axum_extra::extract::CookieJar::from_headers(headers)
        .get(APP_LOGIN_COOKIE)?
        .value()
        .to_string();
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(value).ok()?).ok()
}

/// A SHA-256 digest in base64url without padding: 43 characters.
fn is_s256_challenge(challenge: &str) -> bool {
    challenge.len() == 43
        && challenge
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// RFC 7636 §4.6: the verifier (43–128 unreserved characters) hashes to the challenge.
fn verifier_answers(verifier: &str, challenge: &str) -> bool {
    let well_formed = (43..=128).contains(&verifier.len())
        && verifier
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~'));
    well_formed && URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())) == challenge
}

/// Sign out.
///
/// Ends the presented session server-side, so its token stops working, and
/// clears the session cookie.
#[utoipa::path(
    post,
    path = "/oauth/logout",
    operation_id = "oauth_logout",
    tag = "auth",
    security((), ("session" = []), ("bearer" = [])),
    responses(
        (status = 200, description = "Signed out", body = SuccessResponse),
        (status = 500, description = "The session could not be ended", body = ErrorResponse),
    )
)]
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if let Some(did) = auth::end_session(&state.pool, &headers).await? {
        info!(did = %did, "Logout");
    }

    let secure = state.public_url.is_some();
    Ok((
        AppendHeaders([
            (SET_COOKIE, auth::clear_cookie(SESSION_COOKIE, secure)),
            (
                SET_COOKIE,
                auth::clear_cookie(LEGACY_SESSION_COOKIE, secure),
            ),
        ]),
        Json(SuccessResponse { success: true }),
    )
        .into_response())
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
    security((), ("session" = []), ("bearer" = [])),
    responses((status = 200, description = "The signed-in user, or `null`", body = MeResponse))
)]
pub async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MeResponse>, AppError> {
    let Some(did) = auth::session_did(&state.pool, &headers).await else {
        return Ok(Json(MeResponse { user: None }));
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
            // The session's DID has already been validated as a Did above
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

#[cfg(test)]
mod app_sign_in_tests {
    use super::*;

    // RFC 7636 Appendix B.
    const VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const CHALLENGE: &str = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    fn app(redirect_uri: &str) -> AppLogin {
        AppLogin {
            redirect_uri: redirect_uri.into(),
            state: "app state/with=chars".into(),
            code_challenge: CHALLENGE.into(),
            oauth_state: "oauth-state".into(),
        }
    }

    #[test]
    fn the_rfc_verifier_answers_its_challenge() {
        assert!(is_s256_challenge(CHALLENGE));
        assert!(verifier_answers(VERIFIER, CHALLENGE));
    }

    #[test]
    fn a_wrong_or_malformed_verifier_does_not() {
        let other = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXK";
        assert!(!verifier_answers(other, CHALLENGE));
        assert!(!verifier_answers("short", CHALLENGE));
        assert!(!verifier_answers(&"a".repeat(129), CHALLENGE));
        let spaced = format!("{} ", &VERIFIER[..42]);
        assert!(!verifier_answers(&spaced, CHALLENGE));
    }

    #[test]
    fn only_a_43_character_base64url_digest_is_a_challenge() {
        assert!(!is_s256_challenge(&CHALLENGE[..42]));
        assert!(!is_s256_challenge(&format!("{}=", &CHALLENGE[..42])));
        assert!(!is_s256_challenge(VERIFIER.replace('-', "+").as_str()));
    }

    #[test]
    fn the_app_callback_carries_the_code_and_the_apps_state() {
        assert_eq!(
            app_callback_url(&app("ing.observ.exactspike:/oauth"), &[("code", "abc")]),
            "ing.observ.exactspike:/oauth?code=abc&state=app+state%2Fwith%3Dchars"
        );
        assert_eq!(
            app_callback_url(
                &app("http://127.0.0.1:8765/.exact/auth/callback"),
                &[("error", "access_denied")]
            ),
            "http://127.0.0.1:8765/.exact/auth/callback?error=access_denied&state=app+state%2Fwith%3Dchars"
        );
    }

    #[test]
    fn a_denial_is_passed_on_and_anything_else_is_a_server_error() {
        assert_eq!(app_error(Some("access_denied")), "access_denied");
        assert_eq!(app_error(Some("invalid_request")), "server_error");
        assert_eq!(app_error(None), "server_error");
    }

    #[test]
    fn the_sign_in_cookie_round_trips_and_is_scoped_to_oauth() {
        let login = app("ing.observ.exactspike:/oauth");
        let set = app_login_cookie(&login, true);
        assert!(set.contains("; HttpOnly; Path=/oauth; Max-Age=600; SameSite=Lax; Secure"));
        let pair = set.split(';').next().unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(axum::http::header::COOKIE, pair.parse().unwrap());
        assert_eq!(pending_app_login(&headers), Some(login));

        let mut tampered = HeaderMap::new();
        tampered.insert(
            axum::http::header::COOKIE,
            "app_login=not-base64-json!".parse().unwrap(),
        );
        assert_eq!(pending_app_login(&tampered), None);
    }
}
