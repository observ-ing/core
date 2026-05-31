//! HTML admin browser. Mounts `axum-admin` at `/admin/browse`, gated by an
//! `AdminAuth` extractor that requires a logged-in DID in `ADMIN_DIDS`.
//!
//! The list of browsable tables is the source of truth for the admin
//! surface — there's no parallel JSON API or React page anymore. To
//! expose another table here, add a `(schema, name)` entry to
//! `ADMIN_TABLES`. axum-admin pulls column lists from
//! `information_schema.columns` at request time, so no per-table column
//! config is needed; the schema must be on the connection's
//! `search_path` (it is — `ingester, appview, public` is set
//! database-wide by migration 20260419000000).
//!
//! `oauth_state`/`oauth_sessions` are intentionally excluded — browsing
//! tokens through an admin UI is the failure mode being avoided.

use axum::extract::{FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::middleware::Next;
use axum::response::{IntoResponse, Redirect, Response};
use axum::Router;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

/// `(schema, name)` pairs registered with axum-admin. Browse-everything
/// approach: any table here is visible at `/admin/browse/{schema}/{name}`.
const ADMIN_TABLES: &[(&str, &str)] = &[
    // Internal state.
    ("ingester", "ingester_state"),
    ("ingester", "notifications"),
    ("ingester", "community_ids"),
    ("appview", "occurrence_private_data"),
    ("appview", "notification_reads"),
    ("public", "sensitive_species"),
    // Lexicon record tables (occurrences, identifications, comments,
    // interactions, likes). The browser shows raw rows; per-NSID
    // slicing is gone with the old custom /admin page.
    ("ingester", "occurrences"),
    ("ingester", "identifications"),
    ("ingester", "comments"),
    ("ingester", "interactions"),
    ("ingester", "likes"),
    // Caches and operational tables.
    ("ingester", "taxa"),
    ("ingester", "failed_records"),
];

/// Build the `/admin/browse` router with the AdminAuth gate applied as a
/// middleware. Returns a fully-stated `Router` so the caller can
/// `nest("/admin/browse", router(state))` it under the main app.
pub fn router(state: AppState) -> Router {
    let mut admin = axum_admin::Admin::new();
    for (schema, name) in ADMIN_TABLES {
        admin = admin.table(axum_admin::postgres::PgTable::new(
            state.pool.clone(),
            *schema,
            *name,
        ));
    }
    // The ingester's runtime interface, when its URL is configured. These are
    // HTTP-backed `TableSource`s (no SQL) — see `admin_ingester`.
    if let Some(url) = &state.ingester_url {
        for table in crate::routes::admin_ingester::IngesterApi::tables(url) {
            admin = admin.table(table);
        }
    }
    admin
        .into_router("/admin/browse")
        .layer(axum::middleware::from_fn_with_state(state, require_admin))
}

/// Server-side redirect from the legacy `/admin` route to the HTML
/// browser. The custom React admin page used to live at `/admin`; this
/// keeps old bookmarks working without dragging a SPA route along.
pub async fn redirect_to_browse() -> Redirect {
    Redirect::permanent("/admin/browse")
}

/// Run the `AdminAuth` extractor on every request before passing it
/// through. Empty allowlist → 503, missing session → 401, wrong DID → 403.
async fn require_admin(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let (mut parts, body) = request.into_parts();
    match AdminAuth::from_request_parts(&mut parts, &state).await {
        Ok(_) => next.run(Request::from_parts(parts, body)).await,
        Err(err) => err.into_response(),
    }
}

/// Axum extractor that requires a logged-in user whose DID is in
/// `ADMIN_DIDS`. Rejects with 503 when the allowlist is empty so the
/// admin surface is opt-in by default.
pub struct AdminAuth {
    #[allow(dead_code)]
    pub did: String,
}

impl FromRequestParts<AppState> for AdminAuth {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if state.admin_dids.is_empty() {
            return Err(AppError::ServiceUnavailable(
                "Admin interface is disabled (ADMIN_DIDS not set)".into(),
            ));
        }
        let user = AuthUser::from_request_parts(parts, state).await?;
        if !state.admin_dids.iter().any(|d| d == &user.did) {
            return Err(AppError::Forbidden(
                "Your account is not authorized for admin access".into(),
            ));
        }
        Ok(AdminAuth { did: user.did })
    }
}
