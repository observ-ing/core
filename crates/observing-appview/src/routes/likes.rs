use std::time::Duration;

use axum::extract::State;
use axum::Json;
use chrono::Utc;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::Datetime;
use observing_lexicons::ing_observ::temp::like::{Like, LikeRecord};
use serde::Deserialize;
use tokio::time::sleep;
use tracing::info;
use ts_rs::TS;

use crate::auth::{self, AuthUser};
use crate::error::AppError;
use crate::responses::{RecordCreatedResponse, SuccessResponse};
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
) -> Result<Json<RecordCreatedResponse>, AppError> {
    let now = Utc::now();

    let subject = auth::build_strong_ref(&body.occurrence_uri, &body.occurrence_cid)?;

    let record = Like::new()
        .created_at(Datetime::new(now.fixed_offset()))
        .subject(subject)
        .build();

    let record_value = auth::serialize_at_record(&record)?;

    let (agent, did_parsed) = auth::require_agent(&state.oauth_client, &user.did).await?;
    let output = auth::create_at_record(&agent, did_parsed, LikeRecord::NSID, record_value).await?;

    let uri = output.uri.to_string();
    let cid = output.cid.as_ref().to_string();

    info!(uri = %uri, "Created like (PDS); awaiting ingester for DB row");

    Ok(Json(RecordCreatedResponse {
        success: true,
        uri,
        cid,
    }))
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
) -> Result<Json<SuccessResponse>, AppError> {
    // Short retry window: a rapid like→unlike can race the ingester landing
    // the freshly-created like row. Without this, the lookup returns None and
    // we leak a zombie PDS record.
    let like_uri = find_like_uri_with_retry(&state, &body.occurrence_uri, &user.did).await?;

    if let Some(ref uri) = like_uri {
        // Best-effort: ingester will remove the DB row when the delete commit
        // lands on the firehose.
        let _ = try_delete_atp_record(&state.oauth_client, uri, &user.did).await;
    }

    Ok(Json(SuccessResponse { success: true }))
}

async fn find_like_uri_with_retry(
    state: &AppState,
    subject_uri: &str,
    did: &str,
) -> Result<Option<String>, AppError> {
    const MAX_ATTEMPTS: usize = 5;
    const INTERVAL: Duration = Duration::from_millis(300);

    for attempt in 0..MAX_ATTEMPTS {
        let uri =
            observing_db::likes::find_uri_by_subject_and_did(&state.pool, subject_uri, did).await?;
        if uri.is_some() {
            return Ok(uri);
        }
        if attempt + 1 < MAX_ATTEMPTS {
            sleep(INTERVAL).await;
        }
    }
    Ok(None)
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
