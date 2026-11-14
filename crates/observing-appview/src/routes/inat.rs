//! Linking an iNaturalist account and cross-posting occurrences to it (#878).

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use chrono::{DateTime, Utc};
use inaturalist_oauth::PkceVerifier;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::AtUri;
use observing_db::types::CrosspostRow;
use observing_lexicons::bio_lexicons::temp::v0_1::occurrence::OccurrenceRecord;
use observing_tasks::{Run, Task};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use ts_rs::TS;

use crate::auth::{self, AuthUser};
use crate::error::AppError;
use crate::inat::guard::{self, CrosspostRequest, Refusal};
use crate::inat::{Inat, SERVICE};
use crate::responses::SuccessResponse;
use crate::state::AppState;

/// How long a user has to come back from iNaturalist's authorize page.
const LINK_TTL_MS: i64 = 10 * 60 * 1000;

/// What we hold on to while a user is away authorizing, keyed by the OAuth
/// `state` in `appview.oauth_state`.
#[derive(Serialize, Deserialize)]
struct PendingLink {
    did: String,
    pkce_verifier: PkceVerifier,
    /// An app's callback, when an app started the link (`?redirect_uri=`): the
    /// callback hands iNaturalist's answer to it, and the app finishes at
    /// `POST /api/inat/link` with its own session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    app_redirect: Option<String>,
}

#[derive(Deserialize)]
pub struct AuthorizeParams {
    /// An app's callback (one of `APP_REDIRECT_URIS`): iNaturalist's answer is
    /// handed back to it instead of finishing here.
    redirect_uri: Option<String>,
}

/// Prefixed so these can't collide with the AT Protocol OAuth states that
/// share the table.
fn state_key(state: &str) -> String {
    format!("inat:{state}")
}

fn inat(state: &AppState) -> Result<&Arc<Inat>, AppError> {
    state
        .inat
        .as_ref()
        .ok_or_else(|| AppError::NotFound("iNaturalist cross-posting is not enabled".into()))
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct InatAuthorizeResponse {
    /// iNaturalist's authorize page, for the client to navigate to.
    pub url: String,
}

/// GET /api/inat/authorize
pub async fn authorize(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<AuthorizeParams>,
) -> Result<Json<InatAuthorizeResponse>, AppError> {
    if let Some(uri) = &params.redirect_uri {
        if !state.app_redirect_uris.contains(uri) {
            return Err(AppError::BadRequest(
                "This app isn't allowed to link an account here".into(),
            ));
        }
    }
    let authorization = inat(&state)?
        .authorization_url()
        .map_err(|e| AppError::Internal(e.message))?;
    let pending = serde_json::to_string(&PendingLink {
        did: user.did,
        pkce_verifier: authorization.pkce_verifier,
        app_redirect: params.redirect_uri,
    })
    .map_err(|e| AppError::Internal(e.to_string()))?;
    observing_db::oauth::set_state(
        &state.pool,
        &state_key(&authorization.state),
        &pending,
        LINK_TTL_MS,
    )
    .await?;

    Ok(Json(InatAuthorizeResponse {
        url: authorization.url.to_string(),
    }))
}

#[derive(Deserialize)]
pub struct CallbackParams {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// GET /api/inat/callback?code=...&state=...
///
/// Where iNaturalist sends the user back to. Always redirects to Settings,
/// which reads the marker query parameter to say how it went.
pub async fn callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<CallbackParams>,
) -> Response {
    // A link an app started goes back to the app, which finishes it with its
    // own session; this browser's (if any) plays no part.
    if let Some(app) = app_link(&state, params.state.as_deref()).await {
        return Redirect::to(&app_callback_url(&app, &params)).into_response();
    }
    match link_account(&state, &headers, params).await {
        Ok(login) => {
            info!(login = %login, "Linked iNaturalist account");
            Redirect::to("/settings?inat-linked=1").into_response()
        }
        Err(e) => {
            warn!(error = ?e, "Linking an iNaturalist account failed");
            Redirect::to("/settings?inat-error=1").into_response()
        }
    }
}

/// The app callback of the pending link `oauth_state` names, if an app
/// started it and its callback is still allowed. The link stays pending for
/// the app to finish.
async fn app_link(state: &AppState, oauth_state: Option<&str>) -> Option<String> {
    let pending = observing_db::oauth::get_state(&state.pool, &state_key(oauth_state?))
        .await
        .ok()??;
    let pending: PendingLink = serde_json::from_str(&pending).ok()?;
    pending
        .app_redirect
        .filter(|uri| state.app_redirect_uris.contains(uri))
}

/// The app's callback with iNaturalist's answer: `code` and `state`, or
/// `error` (`access_denied` when the person declined) and `state`.
fn app_callback_url(app: &str, params: &CallbackParams) -> String {
    let Ok(mut url) = url::Url::parse(app) else {
        return "/".to_string();
    };
    {
        let mut q = url.query_pairs_mut();
        match (&params.code, &params.error) {
            (Some(code), None) => q.append_pair("code", code),
            (_, error) => q.append_pair(
                "error",
                if error.as_deref() == Some("access_denied") {
                    "access_denied"
                } else {
                    "server_error"
                },
            ),
        };
        if let Some(s) = &params.state {
            q.append_pair("state", s);
        }
    }
    url.to_string()
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct LinkInatRequest {
    /// The `code` iNaturalist handed to the app's callback.
    pub code: String,
    /// The `state` that came with it.
    pub state: String,
}

/// POST /api/inat/link
///
/// Finish a link an app started (`GET /api/inat/authorize?redirect_uri=`):
/// the app sends iNaturalist's code with its own session, which must be the
/// one that started the link.
pub async fn link_from_app(
    State(state): State<AppState>,
    user: AuthUser,
    Json(LinkInatRequest {
        code,
        state: oauth_state,
    }): Json<LinkInatRequest>,
) -> Result<Json<InatAccountResponse>, AppError> {
    let login = finish_link(&state, &user.did, code, &oauth_state).await?;
    info!(login = %login, "Linked iNaturalist account from an app");
    Ok(Json(InatAccountResponse {
        enabled: true,
        login: Some(login),
        linked_at: Some(Utc::now()),
    }))
}

async fn link_account(
    state: &AppState,
    headers: &HeaderMap,
    params: CallbackParams,
) -> Result<String, AppError> {
    inat(state)?;
    // A denied authorization comes back with `error` and no `code`.
    let (Some(code), Some(oauth_state)) = (params.code, params.state) else {
        return Err(AppError::BadRequest("Authorization was not granted".into()));
    };
    let user = auth::require_auth(&state.pool, headers)
        .await
        .map_err(|_| AppError::Unauthorized)?;
    finish_link(state, &user.did, code, &oauth_state).await
}

/// Trade `code` for tokens and link the account, if `oauth_state` names a
/// pending link that `did` started.
async fn finish_link(
    state: &AppState,
    did: &str,
    code: String,
    oauth_state: &str,
) -> Result<String, AppError> {
    let inat = inat(state)?;

    // The state is single-use, and must have been issued to this session.
    let key = state_key(oauth_state);
    let pending = observing_db::oauth::get_state(&state.pool, &key)
        .await?
        .ok_or_else(|| AppError::BadRequest("Unknown or expired authorization".into()))?;
    observing_db::oauth::delete_state(&state.pool, &key).await?;
    let pending: PendingLink =
        serde_json::from_str(&pending).map_err(|e| AppError::Internal(e.to_string()))?;
    if pending.did != did {
        return Err(AppError::Forbidden(
            "Authorization was started by another session".into(),
        ));
    }

    let tokens = inat
        .exchange_code(code, pending.pkce_verifier)
        .await
        .map_err(|e| AppError::Internal(e.message))?;
    let account = inat
        .client
        .me(&tokens.api_token)
        .await
        .map_err(|e| AppError::Internal(e.message))?;
    observing_db::crossposts::upsert_account(
        &state.pool,
        did,
        SERVICE,
        &account.id.to_string(),
        &account.login,
        &tokens.access_token,
    )
    .await?;
    inat.remember_api_token(did, &tokens.api_token).await;

    Ok(account.login)
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct InatAccountResponse {
    /// Whether this server can cross-post to iNaturalist at all. When false
    /// the client hides everything to do with it.
    pub enabled: bool,
    /// The linked account's iNaturalist login, or null when none is linked.
    #[ts(type = "string | null")]
    pub login: Option<String>,
    #[ts(type = "string | null")]
    pub linked_at: Option<DateTime<Utc>>,
}

/// GET /api/inat/account
pub async fn get_account(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<InatAccountResponse>, AppError> {
    if state.inat.is_none() {
        return Ok(Json(InatAccountResponse {
            enabled: false,
            login: None,
            linked_at: None,
        }));
    }
    let account = observing_db::crossposts::get_account(&state.pool, &user.did, SERVICE).await?;
    Ok(Json(InatAccountResponse {
        enabled: true,
        login: account.as_ref().map(|a| a.external_login.clone()),
        linked_at: account.map(|a| a.linked_at),
    }))
}

/// DELETE /api/inat/account
///
/// Unlinks the account. Observations already cross-posted, and the links to
/// them, stay.
pub async fn delete_account(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<SuccessResponse>, AppError> {
    observing_db::crossposts::delete_account(&state.pool, &user.did, SERVICE).await?;
    if let Some(inat) = &state.inat {
        inat.forget_api_token(&user.did).await;
    }
    Ok(Json(SuccessResponse { success: true }))
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct CrosspostStatusResponse {
    /// Null when the occurrence has never been queued for cross-posting.
    #[ts(type = "\"pending\" | \"synced\" | \"failed\" | null")]
    pub status: Option<String>,
    /// Why the last attempt failed, if it did.
    #[ts(type = "string | null")]
    pub last_error: Option<String>,
    /// The iNaturalist observation, once it exists. This is the
    /// `externalRecords` entry that cross-posting owns.
    #[ts(type = "string | null")]
    pub inat_url: Option<String>,
}

impl From<Option<CrosspostRow>> for CrosspostStatusResponse {
    fn from(row: Option<CrosspostRow>) -> Self {
        match row {
            Some(row) => Self {
                status: Some(row.status),
                last_error: row.last_error,
                inat_url: row.external_uri,
            },
            None => Self {
                status: None,
                last_error: None,
                inat_url: None,
            },
        }
    }
}

/// Parse an occurrence AT URI from a route path, returning the DID it
/// belongs to.
fn occurrence_did(uri: &str) -> Result<String, AppError> {
    let at_uri = AtUri::from_str(uri).map_err(|_| AppError::BadRequest("Invalid AT URI".into()))?;
    if at_uri
        .collection()
        .is_none_or(|c| c.as_str() != OccurrenceRecord::NSID)
    {
        return Err(AppError::BadRequest(
            "URI does not reference an occurrence record".into(),
        ));
    }
    Ok(at_uri.authority().as_str().to_string())
}

/// GET /api/inat/crosspost/{*uri}
///
/// Cross-post status of one of the caller's own occurrences.
pub async fn get_crosspost(
    State(state): State<AppState>,
    user: AuthUser,
    Path(uri): Path<String>,
) -> Result<Json<CrosspostStatusResponse>, AppError> {
    if occurrence_did(&uri)? != user.did {
        return Err(Refusal::NotOwner.into());
    }
    let row = observing_db::crossposts::get(&state.pool, &uri, SERVICE).await?;
    Ok(Json(row.into()))
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct CreateCrosspostRequest {
    /// AT URI of the occurrence to cross-post.
    pub uri: String,
}

/// POST /api/inat/crosspost
///
/// Queue one of the caller's own occurrences for cross-posting, or retry one
/// whose cross-post failed.
///
/// The occurrence is named in a JSON body, like every other write here, and
/// not in the path: a JSON content type can't be sent cross-site without a
/// CORS preflight, which is what keeps another site from triggering this with
/// the caller's session cookie.
pub async fn create_crosspost(
    State(state): State<AppState>,
    user: AuthUser,
    Json(CreateCrosspostRequest { uri }): Json<CreateCrosspostRequest>,
) -> Result<(StatusCode, Json<CrosspostStatusResponse>), AppError> {
    // Only to refuse when cross-posting is off; the worker does the posting.
    inat(&state)?;
    let occurrence_did = occurrence_did(&uri)?;

    // Nothing is looked up for someone else's occurrence.
    let owned = occurrence_did == user.did;
    let linked = owned
        && observing_db::crossposts::get_account(&state.pool, &user.did, SERVICE)
            .await?
            .is_some();
    let occurrence = if owned {
        observing_db::occurrences::get(&state.pool, &uri).await?
    } else {
        None
    };
    let external_records = occurrence.as_ref().map(|o| o.external_record_entries());
    let existing = if owned {
        observing_db::crossposts::get(&state.pool, &uri, SERVICE).await?
    } else {
        None
    };

    guard::check(&CrosspostRequest {
        user_did: &user.did,
        occurrence_did: &occurrence_did,
        linked,
        external_records: external_records.as_deref(),
        crosspost_status: existing.as_ref().map(|row| row.status.as_str()),
        crosspost_uri: existing
            .as_ref()
            .and_then(|row| row.external_uri.as_deref()),
    })?;

    // `enqueue` is the real arbiter: it refuses if another request got in
    // between the check and here.
    if !observing_db::crossposts::enqueue(&state.pool, &uri, SERVICE, &user.did, &[], None).await? {
        return Err(Refusal::AlreadyQueued.into());
    }
    info!(uri = %uri, "Queued occurrence for cross-posting to iNaturalist");
    // Start on it now. If this fails, the hourly backstop run picks it up.
    if let Err(e) = state
        .tasks
        .enqueue(Task::InatCrossposts, Run::default())
        .await
    {
        warn!(uri = %uri, error = %e, "Failed to queue a cross-post run");
    }

    let row = observing_db::crossposts::get(&state.pool, &uri, SERVICE).await?;
    Ok((StatusCode::ACCEPTED, Json(row.into())))
}

#[cfg(test)]
mod app_link_tests {
    use super::*;

    fn params(code: Option<&str>, error: Option<&str>) -> CallbackParams {
        CallbackParams {
            code: code.map(String::from),
            state: Some("s1".into()),
            error: error.map(String::from),
        }
    }

    #[test]
    fn the_app_gets_the_code_and_state() {
        assert_eq!(
            app_callback_url("ing.observ.exactspike:/oauth", &params(Some("c1"), None)),
            "ing.observ.exactspike:/oauth?code=c1&state=s1"
        );
    }

    #[test]
    fn a_denial_is_passed_on_and_anything_else_is_a_server_error() {
        assert_eq!(
            app_callback_url(
                "http://127.0.0.1:8765/.exact/auth/callback",
                &params(None, Some("access_denied"))
            ),
            "http://127.0.0.1:8765/.exact/auth/callback?error=access_denied&state=s1"
        );
        assert_eq!(
            app_callback_url(
                "ing.observ.exactspike:/oauth",
                &params(None, Some("invalid_scope"))
            ),
            "ing.observ.exactspike:/oauth?error=server_error&state=s1"
        );
    }

    #[test]
    fn a_pending_link_from_before_this_change_reads_as_a_web_link() {
        let old = r#"{"did":"did:plc:a","pkce_verifier":"v"}"#;
        let pending: PendingLink = serde_json::from_str(old).unwrap();
        assert_eq!(pending.app_redirect, None);
    }
}
