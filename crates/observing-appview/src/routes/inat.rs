//! Linking an iNaturalist account and cross-posting occurrences to it (#878).

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use axum_extra::extract::CookieJar;
use chrono::{DateTime, Utc};
use inaturalist_oauth::PkceVerifier;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::AtUri;
use observing_db::types::CrosspostRow;
use observing_lexicons::bio_lexicons::temp::v0_1::occurrence::OccurrenceRecord;
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
) -> Result<Json<InatAuthorizeResponse>, AppError> {
    let authorization = inat(&state)?
        .authorization_url()
        .map_err(|e| AppError::Internal(e.0))?;
    let pending = serde_json::to_string(&PendingLink {
        did: user.did,
        pkce_verifier: authorization.pkce_verifier,
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
}

/// GET /api/inat/callback?code=...&state=...
///
/// Where iNaturalist sends the user back to. Always redirects to Settings,
/// which reads the marker query parameter to say how it went.
pub async fn callback(
    State(state): State<AppState>,
    cookies: CookieJar,
    Query(params): Query<CallbackParams>,
) -> Response {
    match link_account(&state, &cookies, params).await {
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

async fn link_account(
    state: &AppState,
    cookies: &CookieJar,
    params: CallbackParams,
) -> Result<String, AppError> {
    let inat = inat(state)?;
    // A denied authorization comes back with `error` and no `code`.
    let (Some(code), Some(oauth_state)) = (params.code, params.state) else {
        return Err(AppError::BadRequest("Authorization was not granted".into()));
    };
    let user = auth::require_auth(&state.pool, cookies)
        .await
        .map_err(|_| AppError::Unauthorized)?;

    // The state is single-use, and must have been issued to this session.
    let key = state_key(&oauth_state);
    let pending = observing_db::oauth::get_state(&state.pool, &key)
        .await?
        .ok_or_else(|| AppError::BadRequest("Unknown or expired authorization".into()))?;
    observing_db::oauth::delete_state(&state.pool, &key).await?;
    let pending: PendingLink =
        serde_json::from_str(&pending).map_err(|e| AppError::Internal(e.to_string()))?;
    if pending.did != user.did {
        return Err(AppError::Forbidden(
            "Authorization was started by another session".into(),
        ));
    }

    let tokens = inat
        .exchange_code(code, pending.pkce_verifier)
        .await
        .map_err(|e| AppError::Internal(e.0))?;
    let account = inat
        .client
        .me(&tokens.api_token)
        .await
        .map_err(|e| AppError::Internal(e.0))?;
    observing_db::crossposts::upsert_account(
        &state.pool,
        &user.did,
        SERVICE,
        &account.id.to_string(),
        &account.login,
        &tokens.access_token,
    )
    .await?;
    inat.remember_api_token(&user.did, &tokens.api_token).await;

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

/// POST /api/inat/crosspost/{*uri}
///
/// Queue one of the caller's own occurrences for cross-posting, or retry one
/// whose cross-post failed.
pub async fn create_crosspost(
    State(state): State<AppState>,
    user: AuthUser,
    Path(uri): Path<String>,
) -> Result<(StatusCode, Json<CrosspostStatusResponse>), AppError> {
    let inat = inat(&state)?;
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
    })?;

    // `enqueue` is the real arbiter: it refuses if another request got in
    // between the check and here.
    if !observing_db::crossposts::enqueue(&state.pool, &uri, SERVICE, &user.did).await? {
        return Err(Refusal::AlreadyQueued.into());
    }
    inat.wake_worker();
    info!(uri = %uri, "Queued occurrence for cross-posting to iNaturalist");

    let row = observing_db::crossposts::get(&state.pool, &uri, SERVICE).await?;
    Ok((StatusCode::ACCEPTED, Json(row.into())))
}
