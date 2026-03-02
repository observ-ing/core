use std::str::FromStr;

use axum::extract::State;
use axum::Json;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::{AtUri, Cid, Datetime};
use observing_lexicons::com_atproto::repo::strong_ref::StrongRef;
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

    let subject = StrongRef::new()
        .uri(
            AtUri::from_str(&body.occurrence_uri)
                .map_err(|_| AppError::BadRequest("Invalid occurrence URI".into()))?,
        )
        .cid(
            Cid::from_str(&body.occurrence_cid)
                .map_err(|_| AppError::BadRequest("Invalid occurrence CID".into()))?,
        )
        .build();

    let reply_to = match (&body.reply_to_uri, &body.reply_to_cid) {
        (Some(uri), Some(cid)) => Some(
            StrongRef::new()
                .uri(
                    AtUri::from_str(uri)
                        .map_err(|_| AppError::BadRequest("Invalid reply-to URI".into()))?,
                )
                .cid(
                    Cid::from_str(cid)
                        .map_err(|_| AppError::BadRequest("Invalid reply-to CID".into()))?,
                )
                .build(),
        ),
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

    let (agent, did_parsed) = auth::require_agent(&state.oauth_client, &user.did).await?;
    let resp = auth::create_at_record(&agent, did_parsed, Comment::NSID, record_value).await?;

    info!(uri = %resp.uri, "Created comment");

    Ok(Json(json!({
        "success": true,
        "uri": resp.uri,
        "cid": resp.cid.as_ref(),
    })))
}
