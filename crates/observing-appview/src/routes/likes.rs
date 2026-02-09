use std::str::FromStr;

use axum::extract::State;
use axum::Json;
use chrono::Utc;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::{AtUri as JAtUri, Cid as JCid, Datetime};
use observing_db::types::CreateLikeParams;
use observing_lexicons::app_bsky::feed::like::Like;
use observing_lexicons::com_atproto::repo::strong_ref::StrongRef;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;
use ts_rs::TS;

use crate::auth;
use crate::error::AppError;
use crate::state::AppState;
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
    cookies: axum_extra::extract::CookieJar,
    Json(body): Json<CreateLikeRequest>,
) -> Result<Json<Value>, AppError> {
    let user = auth::require_auth(&state.pool, &cookies)
        .await
        .map_err(|_| AppError::Unauthorized)?;

    let now = Utc::now();

    let subject = StrongRef::new()
        .uri(
            JAtUri::from_str(&body.occurrence_uri)
                .map_err(|_| AppError::BadRequest("Invalid occurrence URI".into()))?,
        )
        .cid(
            JCid::from_str(&body.occurrence_cid)
                .map_err(|_| AppError::BadRequest("Invalid occurrence CID".into()))?,
        )
        .build();

    let record = Like::new()
        .created_at(Datetime::new(now.fixed_offset()))
        .subject(subject)
        .build();

    let mut record_value =
        serde_json::to_value(&record).map_err(|e| AppError::Internal(e.to_string()))?;
    record_value["$type"] = json!(Like::NSID);

    let resp = state
        .agent
        .create_record(&user.did, Like::NSID, record_value, None)
        .await
        .map_err(AppError::Internal)?;

    let uri = resp
        .uri
        .ok_or_else(|| AppError::Internal("No URI in response".into()))?;
    let cid = resp
        .cid
        .ok_or_else(|| AppError::Internal("No CID in response".into()))?;

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
    let _ = observing_db::likes::create(&state.pool, &params).await;

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
    cookies: axum_extra::extract::CookieJar,
    Json(body): Json<DeleteLikeRequest>,
) -> Result<Json<Value>, AppError> {
    let user = auth::require_auth(&state.pool, &cookies)
        .await
        .map_err(|_| AppError::Unauthorized)?;

    // Delete from local DB first (returns the like URI)
    let like_uri = observing_db::likes::delete_by_subject_and_did(
        &state.pool,
        &body.occurrence_uri,
        &user.did,
    )
    .await?;

    // Try to delete from AT Protocol too (non-fatal: local DB is already updated)
    if let Some(ref uri) = like_uri {
        if let Some(at_uri) = AtUri::parse(uri) {
            if let Ok(did_parsed) = atrium_api::types::string::Did::new(user.did.clone()) {
                if let Ok(session) = state.oauth_client.restore(&did_parsed).await {
                    let agent = atrium_api::agent::Agent::new(session);
                    if let (Ok(collection), Ok(rkey)) =
                        (at_uri.collection.parse(), at_uri.rkey.parse())
                    {
                        let _ = agent
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
                            .await;
                    }
                }
            }
        }
    }

    Ok(Json(json!({ "success": true })))
}
