use std::str::FromStr;

use axum::extract::{Path, State};
use axum::Json;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::{AtUri as JAtUri, Cid as JCid, Datetime};
use observing_lexicons::com_atproto::repo::strong_ref::StrongRef;
use observing_lexicons::org_rwell::test::identification::{Identification, Taxon};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;
use ts_rs::TS;

use crate::auth;
use crate::constants;
use crate::enrichment;
use crate::error::AppError;
use crate::state::AppState;
use at_uri_parser::AtUri;

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
    scientific_name: String,
    #[ts(optional)]
    taxon_rank: Option<String>,
    #[ts(optional)]
    comment: Option<String>,
    #[ts(optional)]
    is_agreement: Option<bool>,
}

pub async fn create_identification(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Json(body): Json<CreateIdentificationRequest>,
) -> Result<Json<Value>, AppError> {
    let user = auth::require_auth(&state.pool, &cookies)
        .await
        .map_err(|_| AppError::Unauthorized)?;

    if body.scientific_name.is_empty()
        || body.scientific_name.len() > constants::MAX_SCIENTIFIC_NAME_LENGTH
    {
        return Err(AppError::BadRequest(
            format!(
                "Scientific name must be 1-{} characters",
                constants::MAX_SCIENTIFIC_NAME_LENGTH
            )
            .into(),
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

    if let Some(validation) = state.taxonomy.validate(&body.scientific_name).await {
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

    let taxon = Taxon {
        scientific_name: (&*body.scientific_name).into(),
        taxon_rank: taxon_rank.as_deref().map(Into::into),
        vernacular_name: vernacular_name.as_deref().map(Into::into),
        kingdom: kingdom.as_deref().map(Into::into),
        phylum: phylum.as_deref().map(Into::into),
        class: class.as_deref().map(Into::into),
        order: order.as_deref().map(Into::into),
        family: family.as_deref().map(Into::into),
        genus: genus.as_deref().map(Into::into),
        ..Default::default()
    };

    let record = Identification::new()
        .taxon(taxon)
        .created_at(Datetime::now())
        .subject(subject)
        .subject_index(body.subject_index.map(|i| i as i64))
        .is_agreement(body.is_agreement.unwrap_or(false))
        .maybe_comment(body.comment.as_deref().map(Into::into))
        .maybe_taxon_id(taxon_id.as_deref().map(Into::into))
        .build();

    let mut record_value =
        serde_json::to_value(&record).map_err(|e| AppError::Internal(e.to_string()))?;
    record_value["$type"] = json!(Identification::NSID);

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
                collection: Identification::NSID
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
                tracing::warn!(error = %e, "AT Protocol authentication failed (session expired)");
                AppError::Unauthorized
            } else {
                AppError::Internal(format!("Failed to create record: {e}"))
            }
        })?;

    info!(uri = %resp.uri, "Created identification");

    Ok(Json(json!({
        "success": true,
        "uri": resp.uri,
        "cid": resp.cid.as_ref(),
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

    // Restore OAuth session and delete the AT Protocol record directly
    let did_parsed = atrium_api::types::string::Did::new(user.did.clone())
        .map_err(|e| AppError::Internal(format!("Invalid DID: {e}")))?;
    let session = state.oauth_client.restore(&did_parsed).await.map_err(|e| {
        tracing::warn!(error = %e, "Failed to restore OAuth session");
        AppError::Unauthorized
    })?;
    let agent = atrium_api::agent::Agent::new(session);
    agent
        .api
        .com
        .atproto
        .repo
        .delete_record(
            atrium_api::com::atproto::repo::delete_record::InputData {
                collection: at_uri
                    .collection
                    .parse()
                    .map_err(|e| AppError::Internal(format!("Invalid collection: {e}")))?,
                repo: atrium_api::types::string::AtIdentifier::Did(did_parsed),
                rkey: at_uri
                    .rkey
                    .parse()
                    .map_err(|e| AppError::Internal(format!("Invalid rkey: {e}")))?,
                swap_commit: None,
                swap_record: None,
            }
            .into(),
        )
        .await
        .map_err(|e| {
            if matches!(e, atrium_api::xrpc::Error::Authentication(_)) {
                tracing::warn!(error = %e, "AT Protocol authentication failed (session expired)");
                AppError::Unauthorized
            } else {
                AppError::Internal(format!("Failed to delete record: {e}"))
            }
        })?;

    // Delete from local DB (refreshes community IDs)
    let _ = observing_db::identifications::delete(&state.pool, &uri).await;

    Ok(Json(json!({ "success": true })))
}
