use std::str::FromStr;

use axum::extract::{Path, State};
use axum::Json;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::{AtUri as JAtUri, Cid as JCid, Datetime};
use observing_records::com_atproto::repo::strong_ref::StrongRef;
use observing_records::org_rwell::test::interaction::{Interaction, InteractionSubject};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;

use crate::auth;
use crate::enrichment;
use crate::error::AppError;
use crate::state::AppState;

pub async fn get_for_occurrence(
    State(state): State<AppState>,
    Path(uri): Path<String>,
) -> Result<Json<Value>, AppError> {
    let rows = observing_db::interactions::get_for_occurrence(&state.pool, &uri).await?;

    let interactions = enrichment::enrich_interactions(&state.resolver, &rows).await;

    Ok(Json(json!({ "interactions": interactions })))
}

// --- Write handlers ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionSubjectRequest {
    occurrence_uri: Option<String>,
    occurrence_cid: Option<String>,
    subject_index: Option<i32>,
    taxon_name: Option<String>,
    kingdom: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInteractionRequest {
    subject_a: InteractionSubjectRequest,
    subject_b: InteractionSubjectRequest,
    interaction_type: String,
    direction: Option<String>,
    confidence: Option<String>,
    comment: Option<String>,
}

fn build_interaction_subject(
    req: &InteractionSubjectRequest,
) -> Result<InteractionSubject<'_>, AppError> {
    let occurrence = match (&req.occurrence_uri, &req.occurrence_cid) {
        (Some(uri), Some(cid)) => Some(
            StrongRef::new()
                .uri(
                    JAtUri::from_str(uri)
                        .map_err(|_| AppError::BadRequest("Invalid occurrence URI".into()))?,
                )
                .cid(
                    JCid::from_str(cid)
                        .map_err(|_| AppError::BadRequest("Invalid occurrence CID".into()))?,
                )
                .build(),
        ),
        _ => None,
    };

    Ok(InteractionSubject {
        kingdom: req.kingdom.as_deref().map(Into::into),
        occurrence,
        subject_index: req.subject_index.map(|i| i as i64),
        taxon_name: req.taxon_name.as_deref().map(Into::into),
        extra_data: None,
    })
}

pub async fn create_interaction(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Json(body): Json<CreateInteractionRequest>,
) -> Result<Json<Value>, AppError> {
    let user = auth::require_auth(&state.pool, &cookies)
        .await
        .map_err(|_| AppError::Unauthorized)?;

    if body.interaction_type.is_empty() || body.interaction_type.len() > 64 {
        return Err(AppError::BadRequest(
            "Interaction type must be 1-64 characters".into(),
        ));
    }

    let direction = body.direction.as_deref().unwrap_or("AtoB");

    let subject_a = build_interaction_subject(&body.subject_a)?;
    let subject_b = build_interaction_subject(&body.subject_b)?;

    let record = Interaction::new()
        .subject_a(subject_a)
        .subject_b(subject_b)
        .interaction_type(&body.interaction_type)
        .direction(direction)
        .created_at(Datetime::now())
        .maybe_confidence(body.confidence.as_deref().map(Into::into))
        .maybe_comment(body.comment.as_deref().map(Into::into))
        .build();

    let mut record_value =
        serde_json::to_value(&record).map_err(|e| AppError::Internal(e.to_string()))?;
    record_value["$type"] = json!(Interaction::NSID);

    let resp = state
        .agent
        .create_record(&user.did, Interaction::NSID, record_value, None)
        .await
        .map_err(AppError::Internal)?;

    let uri = resp
        .uri
        .ok_or_else(|| AppError::Internal("No URI in response".into()))?;
    let cid = resp
        .cid
        .ok_or_else(|| AppError::Internal("No CID in response".into()))?;

    info!(uri = %uri, "Created interaction");

    Ok(Json(json!({
        "success": true,
        "uri": uri,
        "cid": cid,
    })))
}
