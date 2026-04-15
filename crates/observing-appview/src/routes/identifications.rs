use axum::extract::{Path, State};
use axum::Json;
use jacquard_common::types::collection::Collection;
use observing_lexicons::bio_lexicons::temp::identification::{
    Identification, IdentificationRecord, IdentificationTaxonRank,
};
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
        observing_db::identifications::get_community_id(&state.pool, &occurrence_uri).await?;

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
    scientific_name: String,
    #[ts(optional)]
    taxon_rank: Option<String>,
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

    let occurrence = auth::build_strong_ref(&body.occurrence_uri, &body.occurrence_cid)?;

    let record = Identification::new()
        .occurrence(occurrence)
        .scientific_name(&*body.scientific_name)
        .maybe_taxon_rank(
            fields
                .taxon_rank
                .as_deref()
                .map(|s| IdentificationTaxonRank::from_value(s.into())),
        )
        .maybe_kingdom(fields.kingdom.as_deref().map(Into::into))
        .build();

    let mut record_value = auth::serialize_at_record(&record)?;

    // App-specific fields (not in upstream lexicon, stored as extra data in the AT Protocol record)
    if let Some(obj) = record_value.as_object_mut() {
        obj.insert(
            "createdAt".to_string(),
            serde_json::json!(chrono::Utc::now().to_rfc3339()),
        );
        obj.insert(
            "isAgreement".to_string(),
            serde_json::json!(body.is_agreement.unwrap_or(false)),
        );
    }

    let (agent, did_parsed) = auth::require_agent(&state.oauth_client, &user.did).await?;
    let resp = auth::create_at_record(&agent, did_parsed, IdentificationRecord::NSID, record_value)
        .await?;

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
