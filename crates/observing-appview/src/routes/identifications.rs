use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;

use crate::atproto::AtUri;
use crate::auth;
use crate::enrichment;
use crate::error::AppError;
use crate::state::AppState;

pub async fn get_for_occurrence(
    State(state): State<AppState>,
    Path(occurrence_uri): Path<String>,
) -> Result<Json<Value>, AppError> {
    let rows =
        observing_db::identifications::get_for_occurrence(&state.pool, &occurrence_uri).await?;

    let identifications = enrichment::enrich_identifications(&state.resolver, &rows).await;

    let community_id =
        observing_db::identifications::get_community_id(&state.pool, &occurrence_uri, 0).await?;

    Ok(Json(json!({
        "identifications": identifications,
        "communityId": community_id,
    })))
}

// --- Write handlers ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIdentificationRequest {
    occurrence_uri: String,
    occurrence_cid: String,
    subject_index: Option<i32>,
    taxon_name: String,
    taxon_rank: Option<String>,
    comment: Option<String>,
    is_agreement: Option<bool>,
    confidence: Option<String>,
}

pub async fn create_identification(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Json(body): Json<CreateIdentificationRequest>,
) -> Result<Json<Value>, AppError> {
    let user = auth::require_auth(&state.pool, &cookies)
        .await
        .map_err(|_| AppError::Unauthorized)?;

    if body.taxon_name.is_empty() || body.taxon_name.len() > 256 {
        return Err(AppError::BadRequest(
            "Taxon name must be 1-256 characters".into(),
        ));
    }

    // Validate taxonomy via GBIF
    let mut taxon_id = None;
    let mut taxon_rank = body.taxon_rank.clone();
    let mut vernacular_name = None;
    let mut kingdom = None;
    let mut phylum = None;
    let mut class = None;
    let mut order = None;
    let mut family = None;
    let mut genus = None;

    if let Some(validation) = state.taxonomy.validate(&body.taxon_name).await {
        if let Some(ref t) = validation.taxon {
            taxon_id = Some(t.id.clone());
            if taxon_rank.is_none() {
                taxon_rank = Some(t.rank.clone());
            }
            vernacular_name = t.common_name.clone();
            kingdom = t.kingdom.clone();
            phylum = t.phylum.clone();
            class = t.class.clone();
            order = t.order.clone();
            family = t.family.clone();
            genus = t.genus.clone();
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let subject_index = body.subject_index.unwrap_or(0);

    let mut record = json!({
        "$type": "org.rwell.test.identification",
        "subject": {
            "uri": body.occurrence_uri,
            "cid": body.occurrence_cid,
        },
        "subjectIndex": subject_index,
        "taxonName": body.taxon_name,
        "isAgreement": body.is_agreement.unwrap_or(false),
        "createdAt": now,
    });

    if let Some(ref rank) = taxon_rank {
        record["taxonRank"] = json!(rank);
    }
    if let Some(ref comment) = body.comment {
        record["comment"] = json!(comment);
    }
    if let Some(ref conf) = body.confidence {
        record["confidence"] = json!(conf);
    }
    if let Some(ref id) = taxon_id {
        record["taxonId"] = json!(id);
    }
    if let Some(ref vn) = vernacular_name {
        record["vernacularName"] = json!(vn);
    }
    if let Some(ref k) = kingdom {
        record["kingdom"] = json!(k);
    }
    if let Some(ref p) = phylum {
        record["phylum"] = json!(p);
    }
    if let Some(ref c) = class {
        record["class"] = json!(c);
    }
    if let Some(ref o) = order {
        record["order"] = json!(o);
    }
    if let Some(ref f) = family {
        record["family"] = json!(f);
    }
    if let Some(ref g) = genus {
        record["genus"] = json!(g);
    }

    let resp = state
        .agent
        .create_record(&user.did, "org.rwell.test.identification", record, None)
        .await
        .map_err(|e| AppError::Internal(e))?;

    let uri = resp
        .uri
        .ok_or_else(|| AppError::Internal("No URI in response".into()))?;
    let cid = resp
        .cid
        .ok_or_else(|| AppError::Internal("No CID in response".into()))?;

    info!(uri = %uri, "Created identification");

    Ok(Json(json!({
        "success": true,
        "uri": uri,
        "cid": cid,
    })))
}

pub async fn delete_identification(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Path(uri): Path<String>,
) -> Result<Json<Value>, AppError> {
    let user = auth::require_auth(&state.pool, &cookies)
        .await
        .map_err(|_| AppError::Unauthorized)?;

    let at_uri =
        AtUri::parse(&uri).ok_or_else(|| AppError::BadRequest("Invalid AT URI".into()))?;

    if at_uri.did != user.did {
        return Err(AppError::Forbidden(
            "You can only delete your own records".into(),
        ));
    }

    state
        .agent
        .delete_record(&user.did, &at_uri.collection, &at_uri.rkey)
        .await
        .map_err(|e| AppError::Internal(e))?;

    // Delete from local DB (refreshes community IDs)
    let _ = observing_db::identifications::delete(&state.pool, &uri).await;

    Ok(Json(json!({ "success": true })))
}
