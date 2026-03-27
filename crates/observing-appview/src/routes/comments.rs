use axum::extract::State;
use axum::Json;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::Datetime;
use observing_lexicons::org_rwell::test::comment::Comment;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;
use ts_rs::TS;

use crate::auth::{self, AuthUser};
use crate::constants;
use crate::error::AppError;
use crate::state::AppState;
use crate::validation::validate_string_length;

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
    user: AuthUser,
    Json(body): Json<CreateCommentRequest>,
) -> Result<Json<Value>, AppError> {
    validate_string_length(&body.body, 1, constants::MAX_COMMENT_LENGTH, "Comment body")?;

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

    let record_value = auth::serialize_at_record(&record)?;

    let (agent, did_parsed) = auth::require_agent(&state.oauth_client, &user.did).await?;
    let resp = auth::create_at_record(&agent, did_parsed, Comment::NSID, record_value).await?;

    info!(uri = %resp.uri, "Created comment");

    Ok(Json(json!({
        "success": true,
        "uri": resp.uri,
        "cid": resp.cid.as_ref(),
    })))
}
