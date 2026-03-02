use axum::extract::State;
use axum::Json;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::Datetime;
use observing_lexicons::org_rwell::test::comment::Comment;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;
use ts_rs::TS;

use crate::auth;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct CreateCommentRequest {
    occurrence_uri: String,
    occurrence_cid: String,
    body: String,
    #[ts(optional)]
    reply_to_uri: Option<String>,
    #[ts(optional)]
    reply_to_cid: Option<String>,
}

pub async fn create_comment(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Json(body): Json<CreateCommentRequest>,
) -> Result<Json<Value>, AppError> {
    let user = auth::require_auth(&state.pool, &cookies)
        .await
        .map_err(|_| AppError::Unauthorized)?;

    if body.body.is_empty() || body.body.len() > 3000 {
        return Err(AppError::BadRequest(
            "Comment body must be 1-3000 characters".into(),
        ));
    }

    let subject = auth::build_strong_ref(&body.occurrence_uri, &body.occurrence_cid)?;

    let reply_to = match (&body.reply_to_uri, &body.reply_to_cid) {
        (Some(uri), Some(cid)) => Some(auth::build_strong_ref(uri, cid)?),
        _ => None,
    };

    let record = Comment::new()
        .body(&body.body)
        .created_at(Datetime::now())
        .subject(subject)
        .maybe_reply_to(reply_to)
        .build();

    let mut record_value =
        serde_json::to_value(&record).map_err(|e| AppError::Internal(e.to_string()))?;
    record_value["$type"] = json!(Comment::NSID);

    // Restore OAuth session and create the AT Protocol record directly
    let did_parsed = atrium_api::types::string::Did::new(user.did.clone())
        .map_err(|e| AppError::Internal(format!("Invalid DID: {e}")))?;
    let session = state.oauth_client.restore(&did_parsed).await.map_err(|e| {
        tracing::warn!(error = %e, "Failed to restore OAuth session");
        AppError::Unauthorized
    })?;
    let agent = atrium_api::agent::Agent::new(session);
    let resp = agent
        .api
        .com
        .atproto
        .repo
        .create_record(
            atrium_api::com::atproto::repo::create_record::InputData {
                collection: Comment::NSID
                    .parse()
                    .map_err(|e| AppError::Internal(format!("Invalid NSID: {e}")))?,
                record: serde_json::from_value(record_value)
                    .map_err(|e| AppError::Internal(format!("Failed to convert record: {e}")))?,
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
                tracing::warn!(
                    error = %e,
                    "AT Protocol authentication failed (session expired)"
                );
                AppError::Unauthorized
            } else {
                AppError::Internal(format!("Failed to create record: {e}"))
            }
        })?;

    info!(uri = %resp.uri, "Created comment");

    Ok(Json(json!({
        "success": true,
        "uri": resp.uri,
        "cid": resp.cid.as_ref(),
    })))
}
