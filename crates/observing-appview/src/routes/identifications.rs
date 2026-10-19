use axum::extract::{Path, State};
use axum::Json;
use jacquard_common::types::collection::Collection;
use observing_lexicons::bio_lexicons::temp::v0_1::identification::IdentificationRecord;
use serde::Deserialize;
use tracing::info;
use ts_rs::TS;
use utoipa::ToSchema;

use crate::auth::{self, AuthUser};
use crate::constants;
use crate::enrichment;
use crate::error::{AppError, ErrorResponse};
use crate::responses::{IdentificationListResponse, RecordCreatedResponse, SuccessResponse};
use crate::routes::occurrences::auto_id;
use crate::state::AppState;
use crate::validation::validate_string_length;
use jacquard_common::types::string::AtUri;
use std::str::FromStr;

/// List identifications of an occurrence.
#[utoipa::path(
    get,
    path = "/api/identifications/{uri}",
    operation_id = "list_identifications",
    tag = "identifications",
    params(("uri" = String, Path, description = "AT URI of the occurrence (`at://...`), percent-encoded")),
    responses(
        (status = 200, description = "The identifications and the resulting community ID", body = IdentificationListResponse),
    )
)]
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

#[derive(Deserialize, TS, ToSchema)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct CreateIdentificationRequest {
    occurrence_uri: String,
    occurrence_cid: String,
    scientific_name: String,
    #[ts(optional)]
    taxon_rank: Option<String>,
    /// Optional kingdom hint from a GBIF autocomplete pick. Disambiguates
    /// genus-level names for the GBIF validate call and acts as a fallback
    /// when validation doesn't return a kingdom of its own.
    #[ts(optional)]
    kingdom: Option<String>,
    /// Stable taxon URI from a GBIF autocomplete pick (e.g.
    /// `https://www.gbif.org/species/9747581`). Written to the record's
    /// `taxonID`, and resolved by key in place of a name match, which can't
    /// tell homonyms apart.
    #[ts(optional)]
    taxon_id: Option<String>,
}

/// Identify an occurrence.
///
/// Writes an identification record to the caller's PDS. The taxon is resolved
/// against GBIF, by `taxonId` when given and by name otherwise, to fill in its
/// rank and kingdom.
#[utoipa::path(
    post,
    path = "/api/identifications",
    tag = "identifications",
    request_body = CreateIdentificationRequest,
    security(("session" = [])),
    responses(
        (status = 200, description = "The record was written to the caller's PDS", body = RecordCreatedResponse),
        (status = 400, description = "A field failed validation", body = ErrorResponse),
        (status = 401, description = "Not signed in, or the session expired", body = ErrorResponse),
    )
)]
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

    let record_value = auto_id::build_identification_record(
        &state,
        &body.scientific_name,
        body.taxon_rank.as_deref(),
        body.kingdom.as_deref(),
        body.taxon_id.as_deref(),
        &body.occurrence_uri,
        &body.occurrence_cid,
    )
    .await?;

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

/// Delete an identification.
#[utoipa::path(
    delete,
    path = "/api/identifications/{uri}",
    tag = "identifications",
    params(("uri" = String, Path, description = "AT URI of the identification (`at://...`), percent-encoded")),
    security(("session" = [])),
    responses(
        (status = 200, description = "The record was deleted", body = SuccessResponse),
        (status = 400, description = "Invalid AT URI", body = ErrorResponse),
        (status = 401, description = "Not signed in, or the session expired", body = ErrorResponse),
        (status = 403, description = "The identification belongs to someone else", body = ErrorResponse),
    )
)]
pub async fn delete_identification(
    State(state): State<AppState>,
    user: AuthUser,
    Path(uri): Path<String>,
) -> Result<Json<SuccessResponse>, AppError> {
    let at_uri =
        AtUri::from_str(&uri).map_err(|_| AppError::BadRequest("Invalid AT URI".into()))?;

    if at_uri.authority().as_str() != user.did {
        return Err(AppError::Forbidden(
            "You can only delete your own records".into(),
        ));
    }

    let (agent, did_parsed) = auth::require_agent(&state.oauth_client, &user.did).await?;
    let (collection, rkey) = auth::parse_collection_and_rkey(&at_uri)?;
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
        .map_err(|e| {
            if matches!(e, atrium_api::xrpc::Error::Authentication(_)) {
                tracing::warn!(error = %e, "AT Protocol authentication failed (session expired)");
                AppError::Unauthorized
            } else {
                AppError::Internal(format!("Failed to delete record: {e}"))
            }
        })?;

    // The firehose delete commit will trigger the ingester to remove the row
    // and refresh community IDs for the occurrence.
    Ok(Json(SuccessResponse { success: true }))
}
