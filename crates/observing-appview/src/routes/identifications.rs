use std::str::FromStr;

use axum::extract::{Path, State};
use axum::Json;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::{AtUri as JAtUri, Cid as JCid, Datetime};
use observing_lexicons::com_atproto::repo::strong_ref::StrongRef;
use observing_lexicons::org_rwell::test::identification::Identification;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;
use ts_rs::TS;

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

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct CreateIdentificationRequest {
    occurrence_uri: String,
    occurrence_cid: String,
    #[ts(optional)]
    subject_index: Option<i32>,
    taxon_name: String,
    #[ts(optional)]
    taxon_rank: Option<String>,
    #[ts(optional)]
    comment: Option<String>,
    #[ts(optional)]
    is_agreement: Option<bool>,
    #[ts(optional)]
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

    let record = Identification::new()
        .taxon_name(&body.taxon_name)
        .created_at(Datetime::now())
        .subject(subject)
        .subject_index(body.subject_index.map(|i| i as i64))
        .is_agreement(body.is_agreement.unwrap_or(false))
        .maybe_taxon_rank(taxon_rank.as_deref().map(Into::into))
        .maybe_comment(body.comment.as_deref().map(Into::into))
        .maybe_confidence(body.confidence.as_deref().map(Into::into))
        .maybe_taxon_id(taxon_id.as_deref().map(Into::into))
        .maybe_vernacular_name(vernacular_name.as_deref().map(Into::into))
        .maybe_kingdom(kingdom.as_deref().map(Into::into))
        .maybe_phylum(phylum.as_deref().map(Into::into))
        .maybe_class(class.as_deref().map(Into::into))
        .maybe_order(order.as_deref().map(Into::into))
        .maybe_family(family.as_deref().map(Into::into))
        .maybe_genus(genus.as_deref().map(Into::into))
        .build();

    let mut record_value =
        serde_json::to_value(&record).map_err(|e| AppError::Internal(e.to_string()))?;
    record_value["$type"] = json!(Identification::NSID);

    let resp = state
        .agent
        .create_record(&user.did, Identification::NSID, record_value, None)
        .await
        .map_err(AppError::Internal)?;

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

    let at_uri = AtUri::parse(&uri).ok_or_else(|| AppError::BadRequest("Invalid AT URI".into()))?;

    if at_uri.did != user.did {
        return Err(AppError::Forbidden(
            "You can only delete your own records".into(),
        ));
    }

    state
        .agent
        .delete_record(&user.did, &at_uri.collection, &at_uri.rkey)
        .await
        .map_err(AppError::Internal)?;

    // Delete from local DB (refreshes community IDs)
    let _ = observing_db::identifications::delete(&state.pool, &uri).await;

    Ok(Json(json!({ "success": true })))
}
