use axum::extract::{Path, State};
use axum::Json;
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
pub struct InteractionSubject {
    occurrence_uri: Option<String>,
    occurrence_cid: Option<String>,
    subject_index: Option<i32>,
    taxon_name: Option<String>,
    kingdom: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInteractionRequest {
    subject_a: InteractionSubject,
    subject_b: InteractionSubject,
    interaction_type: String,
    direction: Option<String>,
    confidence: Option<String>,
    comment: Option<String>,
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

    let now = chrono::Utc::now().to_rfc3339();
    let direction = body.direction.as_deref().unwrap_or("AtoB");

    let mut subject_a = json!({});
    if let Some(ref uri) = body.subject_a.occurrence_uri {
        subject_a["occurrenceUri"] = json!(uri);
    }
    if let Some(ref cid) = body.subject_a.occurrence_cid {
        subject_a["occurrenceCid"] = json!(cid);
    }
    subject_a["subjectIndex"] = json!(body.subject_a.subject_index.unwrap_or(0));
    if let Some(ref name) = body.subject_a.taxon_name {
        subject_a["taxonName"] = json!(name);
    }
    if let Some(ref k) = body.subject_a.kingdom {
        subject_a["kingdom"] = json!(k);
    }

    let mut subject_b = json!({});
    if let Some(ref uri) = body.subject_b.occurrence_uri {
        subject_b["occurrenceUri"] = json!(uri);
    }
    if let Some(ref cid) = body.subject_b.occurrence_cid {
        subject_b["occurrenceCid"] = json!(cid);
    }
    subject_b["subjectIndex"] = json!(body.subject_b.subject_index.unwrap_or(0));
    if let Some(ref name) = body.subject_b.taxon_name {
        subject_b["taxonName"] = json!(name);
    }
    if let Some(ref k) = body.subject_b.kingdom {
        subject_b["kingdom"] = json!(k);
    }

    let mut record = json!({
        "$type": "org.rwell.test.interaction",
        "subjectA": subject_a,
        "subjectB": subject_b,
        "interactionType": body.interaction_type,
        "direction": direction,
        "createdAt": now,
    });

    if let Some(ref conf) = body.confidence {
        record["confidence"] = json!(conf);
    }
    if let Some(ref comment) = body.comment {
        record["comment"] = json!(comment);
    }

    let resp = state
        .agent
        .create_record(&user.did, "org.rwell.test.interaction", record, None)
        .await
        .map_err(|e| AppError::Internal(e))?;

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
