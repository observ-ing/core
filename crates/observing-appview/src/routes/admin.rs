//! Lexicon-scoped admin endpoints: count/list/delete records by NSID.
//!
//! All routes require the `ADMIN_TOKEN` env var to be set and a matching
//! `Authorization: Bearer <token>` header. When `ADMIN_TOKEN` is unset, every
//! admin route returns 503 so the surface is opt-in by default.

use axum::extract::{FromRequestParts, Path, Query, State};
use axum::http::request::Parts;
use axum::Json;
use observing_db::admin as db_admin;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::AppState;

/// Axum extractor that enforces `Authorization: Bearer <ADMIN_TOKEN>`.
///
/// Returns 503 (Service Unavailable) when no token is configured — the admin
/// interface is disabled by default until an operator opts in.
pub struct AdminAuth;

impl FromRequestParts<AppState> for AdminAuth {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let Some(expected) = state.admin_token.as_deref() else {
            return Err(AppError::ServiceUnavailable(
                "Admin interface is disabled (ADMIN_TOKEN not set)".into(),
            ));
        };
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::Unauthorized)?;
        let token = header
            .strip_prefix("Bearer ")
            .ok_or(AppError::Unauthorized)?;
        // Constant-time compare to avoid timing side-channels.
        if !ct_eq(token.as_bytes(), expected.as_bytes()) {
            return Err(AppError::Unauthorized);
        }
        Ok(AdminAuth)
    }
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[derive(Serialize)]
pub struct CollectionSummary {
    pub nsid: &'static str,
    pub table: &'static str,
    pub count: i64,
    pub cascades_to: &'static [&'static str],
}

#[derive(Serialize)]
pub struct CollectionsListResponse {
    pub collections: Vec<CollectionSummary>,
    pub total: i64,
}

/// `GET /admin/collections` — list all known NSIDs and their row counts.
pub async fn list_collections(
    _auth: AdminAuth,
    State(state): State<AppState>,
) -> Result<Json<CollectionsListResponse>, AppError> {
    let mut out = Vec::with_capacity(db_admin::KNOWN_COLLECTIONS.len());
    let mut total = 0i64;
    for meta in db_admin::KNOWN_COLLECTIONS {
        let count = db_admin::count(&state.pool, meta.nsid).await?;
        total += count;
        out.push(CollectionSummary {
            nsid: meta.nsid,
            table: meta.table,
            count,
            cascades_to: meta.cascades_to,
        });
    }
    Ok(Json(CollectionsListResponse {
        collections: out,
        total,
    }))
}

#[derive(Serialize)]
pub struct CollectionDetail {
    #[serde(flatten)]
    pub stats: db_admin::CollectionStats,
    pub cascades_to: &'static [&'static str],
}

/// `GET /admin/collections/{nsid}` — detailed stats for a single NSID.
pub async fn get_collection(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Path(nsid): Path<String>,
) -> Result<Json<CollectionDetail>, AppError> {
    let meta = db_admin::lookup(&nsid)
        .ok_or_else(|| AppError::NotFound(format!("Unknown NSID: {nsid}")))?;
    let stats = db_admin::stats(&state.pool, &nsid)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Unknown NSID: {nsid}")))?;
    Ok(Json(CollectionDetail {
        stats,
        cascades_to: meta.cascades_to,
    }))
}

#[derive(Deserialize)]
pub struct ListRecordsQuery {
    pub did: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 {
    50
}

#[derive(Serialize)]
pub struct ListRecordsResponse {
    pub records: Vec<db_admin::RecordSummary>,
    pub limit: i64,
    pub offset: i64,
}

/// `GET /admin/collections/{nsid}/records` — paginated list of records.
pub async fn list_records(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Path(nsid): Path<String>,
    Query(params): Query<ListRecordsQuery>,
) -> Result<Json<ListRecordsResponse>, AppError> {
    if db_admin::lookup(&nsid).is_none() {
        return Err(AppError::NotFound(format!("Unknown NSID: {nsid}")));
    }
    let limit = params.limit.clamp(1, 500);
    let offset = params.offset.max(0);
    let records =
        db_admin::list_records(&state.pool, &nsid, params.did.as_deref(), limit, offset).await?;
    Ok(Json(ListRecordsResponse {
        records,
        limit,
        offset,
    }))
}

#[derive(Deserialize)]
pub struct DeleteCollectionQuery {
    /// Must match the NSID in the path. Prevents accidental deletion.
    pub confirm: String,
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Serialize)]
pub struct DeleteCollectionResponse {
    pub nsid: String,
    pub dry_run: bool,
    pub rows_affected: u64,
    /// Tables whose rows were deleted by cascade (best-effort — not a count).
    pub cascades_to: &'static [&'static str],
}

/// `DELETE /admin/collections/{nsid}` — purge all rows for an NSID.
///
/// Requires `?confirm={nsid}` (must match the path). Pass `?dry_run=true` to
/// return the count that *would* be deleted without executing the DELETE.
pub async fn delete_collection(
    _auth: AdminAuth,
    State(state): State<AppState>,
    Path(nsid): Path<String>,
    Query(params): Query<DeleteCollectionQuery>,
) -> Result<Json<DeleteCollectionResponse>, AppError> {
    let meta = db_admin::lookup(&nsid)
        .ok_or_else(|| AppError::NotFound(format!("Unknown NSID: {nsid}")))?;
    if params.confirm != nsid {
        return Err(AppError::BadRequest(
            "confirm parameter must match the NSID in the path".into(),
        ));
    }

    if params.dry_run {
        let count = db_admin::count(&state.pool, &nsid).await?;
        tracing::warn!(nsid = %nsid, count, "admin delete dry-run");
        return Ok(Json(DeleteCollectionResponse {
            nsid,
            dry_run: true,
            rows_affected: count as u64,
            cascades_to: meta.cascades_to,
        }));
    }

    let rows_affected = db_admin::delete_by_nsid(&state.pool, &nsid).await?;
    tracing::warn!(
        nsid = %nsid,
        rows_affected,
        "admin delete executed"
    );
    Ok(Json(DeleteCollectionResponse {
        nsid,
        dry_run: false,
        rows_affected,
        cascades_to: meta.cascades_to,
    }))
}
