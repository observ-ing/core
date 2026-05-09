//! HTML admin browser. Mounts `axum-admin` at `/admin/browse`, gated by the
//! same DID allowlist as the JSON `/admin/*` endpoints.
//!
//! Tables exposed are pulled from `observing_db::admin::KNOWN_TABLES` so the
//! HTML browser and the JSON API share a single allowlist.

use axum::extract::{FromRequestParts, Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Router;
use observing_db::admin::KNOWN_TABLES;

use crate::routes::admin::AdminAuth;
use crate::state::AppState;

/// Build the `/admin/browse` router with the existing AdminAuth gate applied
/// as a middleware. Returns a fully-stated `Router` so the caller can
/// `nest("/admin/browse", router(state))` it under the main app.
pub fn router(state: AppState) -> Router {
    let mut admin = axum_admin::Admin::new(state.pool.clone());
    for meta in KNOWN_TABLES {
        admin = admin.table(meta.name, |t| t);
    }
    admin
        .into_router("/admin/browse")
        .layer(axum::middleware::from_fn_with_state(state, require_admin))
}

/// Run the `AdminAuth` extractor on every request before passing it through.
/// Same gate as the JSON admin routes — empty allowlist → 503, missing
/// session → 401, wrong DID → 403.
async fn require_admin(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let (mut parts, body) = request.into_parts();
    match AdminAuth::from_request_parts(&mut parts, &state).await {
        Ok(_) => next.run(Request::from_parts(parts, body)).await,
        Err(err) => err.into_response(),
    }
}
