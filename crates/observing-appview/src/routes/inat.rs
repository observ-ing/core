//! Linking an iNaturalist account (#878).

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use axum_extra::extract::CookieJar;
use chrono::{DateTime, Utc};
use inaturalist_oauth::PkceVerifier;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use ts_rs::TS;

use crate::auth::{self, AuthUser};
use crate::error::AppError;
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
        .ok_or_else(|| AppError::NotFound("iNaturalist is not enabled".into()))
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
        .map_err(|e| AppError::Internal(e.message))?;
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
        .map_err(|e| AppError::Internal(e.message))?;
    let account = inat
        .client
        .me(&tokens.api_token)
        .await
        .map_err(|e| AppError::Internal(e.message))?;
    observing_db::crossposts::upsert_account(
        &state.pool,
        &user.did,
        SERVICE,
        &account.id.to_string(),
        &account.login,
        &tokens.access_token,
    )
    .await?;

    Ok(account.login)
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct InatAccountResponse {
    /// Whether this server has iNaturalist enabled at all. When false the
    /// client hides everything to do with it.
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
/// Unlinks the account.
pub async fn delete_account(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<SuccessResponse>, AppError> {
    observing_db::crossposts::delete_account(&state.pool, &user.did, SERVICE).await?;
    Ok(Json(SuccessResponse { success: true }))
}
