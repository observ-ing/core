use axum::extract::{Path, State};
use axum::Json;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::Datetime;
use observing_lexicons::org_rwell::test::identification::{Identification, Taxon};
use serde::Deserialize;
use tracing::{info, warn};
use ts_rs::TS;

use crate::auth::{self, AuthUser};
use crate::constants;
use crate::enrichment;
use crate::error::AppError;
use crate::responses::{IdentificationListResponse, RecordCreatedResponse, SuccessResponse};
use crate::state::AppState;
use crate::taxonomy_client::TaxonFields;
use crate::validation::validate_string_length;
use at_uri_parser::AtUri;

pub async fn get_for_occurrence(
    State(state): State<AppState>,
    Path(occurrence_uri): Path<String>,
) -> Result<Json<IdentificationListResponse>, AppError> {
    let rows =
        observing_db::identifications::get_for_occurrence(&state.pool, &occurrence_uri).await?;

    let identifications = enrichment::enrich_identifications(&state.resolver, &rows).await;

    let community_id =
        observing_db::identifications::get_community_id(&state.pool, &occurrence_uri, 0).await?;

    Ok(Json(IdentificationListResponse {
        identifications,
        community_id,
    }))
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
    user: AuthUser,
    Json(body): Json<CreateIdentificationRequest>,
) -> Result<Json<RecordCreatedResponse>, AppError> {
    validate_string_length(
        &body.scientific_name,
        1,
        constants::MAX_SCIENTIFIC_NAME_LENGTH,
        "Scientific name",
    )?;

    // Validate taxonomy via GBIF
    let fields = TaxonFields::from_validation(
        &state.taxonomy,
        &body.scientific_name,
        body.taxon_rank.clone(),
    )
    .await;

    let subject = auth::build_strong_ref(&body.occurrence_uri, &body.occurrence_cid)?;

    let taxon = Taxon {
        scientific_name: (&*body.scientific_name).into(),
        taxon_rank: fields.taxon_rank.as_deref().map(Into::into),
        vernacular_name: fields.vernacular_name.as_deref().map(Into::into),
        kingdom: fields.kingdom.as_deref().map(Into::into),
        phylum: fields.phylum.as_deref().map(Into::into),
        class: fields.class.as_deref().map(Into::into),
        order: fields.order.as_deref().map(Into::into),
        family: fields.family.as_deref().map(Into::into),
        genus: fields.genus.as_deref().map(Into::into),
        ..Default::default()
    };

    let record = Identification::new()
        .taxon(taxon)
        .created_at(Datetime::now())
        .subject(subject)
        .subject_index(body.subject_index.map(|i| i as i64))
        .is_agreement(body.is_agreement.unwrap_or(false))
        .maybe_comment(body.comment.as_deref().map(Into::into))
        .maybe_taxon_id(fields.taxon_id.as_deref().map(Into::into))
        .build();

    let record_value = auth::serialize_at_record(&record)?;

    let (agent, did_parsed) = auth::require_agent(&state.oauth_client, &user.did).await?;
    let resp =
        auth::create_at_record(&agent, did_parsed, Identification::NSID, record_value).await?;

    info!(uri = %resp.uri, "Created identification");

    Ok(Json(RecordCreatedResponse {
        success: true,
        uri: resp.uri.to_string(),
        cid: resp.cid.as_ref().to_string(),
    }))
}

pub async fn delete_identification(
    State(state): State<AppState>,
    user: AuthUser,
    Path(uri): Path<String>,
) -> Result<Json<SuccessResponse>, AppError> {
    let at_uri = AtUri::parse(&uri).ok_or_else(|| AppError::BadRequest("Invalid AT URI".into()))?;

    if at_uri.did != user.did {
        return Err(AppError::Forbidden(
            "You can only delete your own records".into(),
        ));
    }

    let (agent, did_parsed) = auth::require_agent(&state.oauth_client, &user.did).await?;
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
    if let Err(e) = observing_db::identifications::delete(&state.pool, &uri).await {
        warn!(error = %e, "Failed to delete identification from local DB");
    }

    Ok(Json(SuccessResponse { success: true }))
}
