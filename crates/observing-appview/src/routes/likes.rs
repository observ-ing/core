use axum::extract::State;
use axum::Json;
use chrono::Utc;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::Datetime;
use observing_db::types::CreateLikeParams;
use observing_lexicons::org_rwell::test::like::Like;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::{info, warn};
use ts_rs::TS;

use crate::auth::{self, AuthUser};
use crate::error::AppError;
use crate::state::{AppState, OAuthClientType};
use at_uri_parser::AtUri;

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct CreateLikeRequest {
    occurrence_uri: String,
    occurrence_cid: String,
}

pub async fn create_like(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateLikeRequest>,
) -> Result<Json<Value>, AppError> {
    let now = Utc::now();

    let subject = auth::build_strong_ref(&body.occurrence_uri, &body.occurrence_cid)?;

    let record = Like::new()
        .created_at(Datetime::new(now.fixed_offset()))
        .subject(subject)
        .build();

    let record_value = auth::serialize_at_record(&record)?;

    let (agent, did_parsed) = auth::require_agent(&state.oauth_client, &user.did).await?;
    let output = auth::create_at_record(&agent, did_parsed, Like::NSID, record_value).await?;

    let uri = output.uri.clone();
    let cid = output.cid.as_ref().to_string();

    info!(uri = %uri, "Created like");

    // Immediate local DB insert
    let params = CreateLikeParams {
        uri: uri.clone(),
        cid: cid.clone(),
        did: user.did,
        subject_uri: body.occurrence_uri,
        subject_cid: body.occurrence_cid,
        created_at: now.naive_utc(),
    };
    if let Err(e) = observing_db::likes::create(&state.pool, &params).await {
        warn!(error = %e, "Failed to insert like into local DB");
    }

    Ok(Json(json!({
        "success": true,
        "uri": uri,
        "cid": cid,
    })))
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct DeleteLikeRequest {
    occurrence_uri: String,
}

pub async fn delete_like(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<DeleteLikeRequest>,
) -> Result<Json<Value>, AppError> {
    // Delete from local DB first (returns the like URI)
    let like_uri = observing_db::likes::delete_by_subject_and_did(
        &state.pool,
        &body.occurrence_uri,
        &user.did,
    )
    .await?;

    // Try to delete from AT Protocol too (non-fatal: local DB is already updated)
    if let Some(ref uri) = like_uri {
        let _ = try_delete_atp_record(&state.oauth_client, uri, &user.did).await;
    }

    Ok(Json(json!({ "success": true })))
}

/// Best-effort deletion of an AT Protocol record. Returns `None` if any step
/// fails (URI parsing, session restore, network call), which the caller can
/// safely ignore.
async fn try_delete_atp_record(oauth_client: &OAuthClientType, uri: &str, did: &str) -> Option<()> {
    let at_uri = AtUri::parse(uri)?;
    let did_parsed = atrium_api::types::string::Did::new(did.to_owned()).ok()?;
    let session = oauth_client.restore(&did_parsed).await.ok()?;
    let agent = atrium_api::agent::Agent::new(session);
    let collection = at_uri.collection.parse().ok()?;
    let rkey = at_uri.rkey.parse().ok()?;

    agent
        .api
        .com
        .atproto
        .repo
        .delete_record(
            atrium_api::com::atproto::repo::delete_record::InputData {
                collection,
                repo: atrium_api::types::string::AtIdentifier::Did(did_parsed),
                rkey,
                swap_commit: None,
                swap_record: None,
            }
            .into(),
        )
        .await
        .ok()?;

    Some(())
}
