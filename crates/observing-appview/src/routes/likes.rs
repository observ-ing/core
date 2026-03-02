use axum::extract::State;
use axum::Json;
use chrono::Utc;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::Datetime;
use observing_db::types::CreateLikeParams;
use observing_lexicons::org_rwell::test::like::Like;
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

    let subject = auth::build_strong_ref(&body.occurrence_uri, &body.occurrence_cid)?;

    let record = Like::new()
        .created_at(Datetime::new(now.fixed_offset()))
        .subject(subject)
        .build();

    let mut record_value =
        serde_json::to_value(&record).map_err(|e| AppError::Internal(e.to_string()))?;
    record_value["$type"] = json!(Like::NSID);

    // Restore OAuth session and create record directly
    let did_parsed = atrium_api::types::string::Did::new(user.did.clone())
        .map_err(|e| AppError::Internal(format!("Invalid DID: {e}")))?;
    let session = state.oauth_client.restore(&did_parsed).await.map_err(|e| {
        tracing::warn!(error = %e, "Failed to restore OAuth session");
        AppError::Unauthorized
    })?;
    let agent = atrium_api::agent::Agent::new(session);

    let record_unknown: atrium_api::types::Unknown = serde_json::from_value(record_value)
        .map_err(|e| AppError::Internal(format!("Failed to convert record: {e}")))?;

    let output = agent
        .api
        .com
        .atproto
        .repo
        .create_record(
            atrium_api::com::atproto::repo::create_record::InputData {
                collection: Like::NSID
                    .parse()
                    .map_err(|e| AppError::Internal(format!("Invalid NSID: {e}")))?,
                record: record_unknown,
                repo: atrium_api::types::string::AtIdentifier::Did(did_parsed),
                rkey: None,
                swap_commit: None,
                validate: None,
            }
            .into(),
        )
        .await
        .map_err(|e| {
            if matches!(e, atrium_api::xrpc::Error::Authentication(_)) {
                tracing::warn!(error = %e, "AT Protocol authentication failed");
                AppError::Unauthorized
            } else {
                AppError::Internal(format!("Failed to create like record: {e}"))
            }
        })?;

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
