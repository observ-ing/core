//! Test-only endpoint that bypasses the firehose → tap-ingester → DB
//! pipeline by fetching a single record from the author's PDS and
//! writing it straight to appview's Postgres.
//!
//! Exists for e2e tests where the firehose round-trip would otherwise
//! race the assertion window (see issue #473). Gated at startup by
//! `ENABLE_TEST_ROUTES=1`; the route is not registered when unset, so
//! production deploys never expose it.

use at_uri_parser::AtUri;
use atproto_identity::Did;
use axum::extract::State;
use axum::Json;
use chrono::Utc;
use observing_db::processing;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::info;

use crate::error::AppError;
use crate::state::AppState;

// Duplicated from `tap-ingester::types` rather than depending on the
// ingester crate from appview. Test-only surface; keep the dependency
// graph clean.
const OCCURRENCE_COLLECTION: &str = "bio.lexicons.temp.v0-1.occurrence";
const IDENTIFICATION_COLLECTION: &str = "bio.lexicons.temp.v0-1.identification";
const COMMENT_COLLECTION: &str = "ing.observ.temp.comment";
const INTERACTION_COLLECTION: &str = "ing.observ.temp.interaction";
const LIKE_COLLECTION: &str = "ing.observ.temp.like";

#[derive(Deserialize)]
pub struct SeedRecordRequest {
    pub uri: String,
}

#[derive(Serialize)]
pub struct SeedRecordResponse {
    pub success: bool,
    pub uri: String,
    pub cid: String,
}

pub async fn seed_record(
    State(state): State<AppState>,
    Json(body): Json<SeedRecordRequest>,
) -> Result<Json<SeedRecordResponse>, AppError> {
    let at_uri =
        AtUri::parse(&body.uri).ok_or_else(|| AppError::BadRequest("Invalid AT URI".into()))?;

    let did =
        Did::parse(&at_uri.did).map_err(|e| AppError::BadRequest(format!("Invalid DID: {e}")))?;

    let pds_url = state.resolver.get_pds_endpoint(&did).await.ok_or_else(|| {
        AppError::BadRequest(format!("Could not resolve PDS for {}", did.as_str()))
    })?;

    let fetch_url = format!(
        "{}/xrpc/com.atproto.repo.getRecord?repo={}&collection={}&rkey={}",
        pds_url.trim_end_matches('/'),
        urlencoding::encode(&at_uri.did),
        urlencoding::encode(&at_uri.collection),
        urlencoding::encode(&at_uri.rkey),
    );

    let resp = reqwest::Client::new()
        .get(&fetch_url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("PDS fetch failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::NotFound(format!(
            "Record not found on PDS (status {})",
            resp.status()
        )));
    }
    let pds_body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Invalid PDS response: {e}")))?;

    let cid = pds_body
        .get("cid")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("PDS response missing cid".into()))?
        .to_string();
    let record_value = pds_body
        .get("value")
        .cloned()
        .ok_or_else(|| AppError::Internal("PDS response missing value".into()))?;

    let now = Utc::now();

    match at_uri.collection.as_str() {
        OCCURRENCE_COLLECTION => {
            let parsed = processing::occurrence_from_json(
                &record_value,
                body.uri.clone(),
                cid.clone(),
                at_uri.did.clone(),
                now,
            )
            .map_err(|e| AppError::BadRequest(format!("Failed to parse occurrence: {e}")))?;
            // associated_media is left unresolved here. The test path
            // only asserts the occurrence row exists; media-blob
            // resolution is exercised separately via tap-ingester.
            observing_db::occurrences::upsert(&state.pool, &parsed.params).await?;
        }
        IDENTIFICATION_COLLECTION => {
            let params = processing::identification_from_json(
                &record_value,
                body.uri.clone(),
                cid.clone(),
                at_uri.did.clone(),
                now,
            )
            .map_err(|e| AppError::BadRequest(format!("Failed to parse identification: {e}")))?;
            observing_db::identifications::upsert(&state.pool, &params).await?;
        }
        COMMENT_COLLECTION => {
            let params = processing::comment_from_json(
                &record_value,
                body.uri.clone(),
                cid.clone(),
                at_uri.did.clone(),
                now,
            )
            .map_err(|e| AppError::BadRequest(format!("Failed to parse comment: {e}")))?;
            observing_db::comments::upsert(&state.pool, &params).await?;
        }
        INTERACTION_COLLECTION => {
            let params = processing::interaction_from_json(
                &record_value,
                body.uri.clone(),
                cid.clone(),
                at_uri.did.clone(),
                now,
            )
            .map_err(|e| AppError::BadRequest(format!("Failed to parse interaction: {e}")))?;
            observing_db::interactions::upsert(&state.pool, &params).await?;
        }
        LIKE_COLLECTION => {
            let params = processing::like_from_json(
                &record_value,
                body.uri.clone(),
                cid.clone(),
                at_uri.did.clone(),
                now,
            )
            .map_err(|e| AppError::BadRequest(format!("Failed to parse like: {e}")))?;
            observing_db::likes::create(&state.pool, &params).await?;
        }
        other => {
            return Err(AppError::BadRequest(format!(
                "Unsupported collection: {other}"
            )));
        }
    }

    info!(uri = %body.uri, "Seeded record from PDS");
    Ok(Json(SeedRecordResponse {
        success: true,
        uri: body.uri,
        cid,
    }))
}
