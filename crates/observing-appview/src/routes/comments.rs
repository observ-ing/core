use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;

use crate::auth;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCommentRequest {
    occurrence_uri: String,
    occurrence_cid: String,
    body: String,
    reply_to_uri: Option<String>,
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

    let now = chrono::Utc::now().to_rfc3339();

    let mut record = json!({
        "$type": "org.rwell.test.comment",
        "subject": {
            "uri": body.occurrence_uri,
            "cid": body.occurrence_cid,
        },
        "body": body.body,
        "createdAt": now,
    });

    if let (Some(uri), Some(cid)) = (&body.reply_to_uri, &body.reply_to_cid) {
        record["replyTo"] = json!({ "uri": uri, "cid": cid });
    }

    let resp = state
        .agent
        .create_record(&user.did, "org.rwell.test.comment", record, None)
        .await
        .map_err(|e| AppError::Internal(e))?;

    let uri = resp
        .uri
        .ok_or_else(|| AppError::Internal("No URI in response".into()))?;
    let cid = resp
        .cid
        .ok_or_else(|| AppError::Internal("No CID in response".into()))?;

    info!(uri = %uri, "Created comment");

    Ok(Json(json!({
        "success": true,
        "uri": uri,
        "cid": cid,
    })))
}
