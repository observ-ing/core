use axum::extract::{Path, State};
use axum::Json;
use chrono::Utc;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::Datetime;
use observing_lexicons::bio_lexicons::temp::media::Media;
use observing_lexicons::bio_lexicons::temp::occurrence::Occurrence;
use serde::Deserialize;
use serde_json::json;
use tracing::{info, warn};
use ts_rs::TS;

use crate::auth::{self, AuthUser};
use crate::constants;
use crate::error::AppError;
use crate::responses::{RecordCreatedResponse, SuccessResponse};
use crate::state::AppState;
use at_uri_parser::AtUri;

use super::auto_id;

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct CreateOccurrenceRequest {
    latitude: f64,
    longitude: f64,
    #[ts(optional)]
    coordinate_uncertainty_in_meters: Option<i32>,
    #[ts(optional)]
    event_date: Option<String>,
    #[ts(optional)]
    images: Option<Vec<ImageUpload>>,
    #[ts(optional)]
    recorded_by: Option<Vec<String>>,
    #[ts(optional)]
    scientific_name: Option<String>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct ImageUpload {
    data: String, // base64
    /// Deserialized from frontend but unused — PDS infers MIME type from bytes.
    #[allow(dead_code)]
    mime_type: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct AddObserverRequest {
    did: String,
}

pub async fn create_occurrence(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateOccurrenceRequest>,
) -> Result<Json<RecordCreatedResponse>, AppError> {
    // Validate coordinates
    if !(-90.0..=90.0).contains(&body.latitude) || !(-180.0..=180.0).contains(&body.longitude) {
        return Err(AppError::BadRequest("Invalid coordinates".into()));
    }

    // Restore OAuth session for AT Protocol operations
    let (agent, did_parsed) = auth::require_agent(&state.oauth_client, &user.did).await?;

    // Upload blobs, create media records, and collect strong refs
    let mut blob_entries = Vec::new(); // For DB storage (blob CIDs for image serving)
    let mut media_refs = Vec::new(); // For the AT Protocol record (strong refs to media)
    if let Some(images) = &body.images {
        use base64::Engine;
        for img in images {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&img.data)
                .map_err(|e| AppError::BadRequest(format!("Invalid base64 image data: {e}")))?;
            let blob_resp = agent
                .api
                .com
                .atproto
                .repo
                .upload_blob(bytes)
                .await
                .map_err(|e| AppError::Internal(format!("Failed to upload blob: {e}")))?;
            let blob_value = serde_json::to_value(&blob_resp.blob)
                .map_err(|e| AppError::Internal(format!("Failed to serialize blob: {e}")))?;
            blob_entries.push(json!({ "image": blob_value, "alt": "" }));

            // Create a bio.lexicons.temp.media record
            let media_record_value = json!({
                "$type": Media::NSID,
                "image": blob_value,
            });
            let did_for_media = atrium_api::types::string::Did::new(user.did.clone())
                .map_err(|e| AppError::Internal(format!("Invalid DID: {e}")))?;
            match auth::create_at_record(&agent, did_for_media, Media::NSID, media_record_value)
                .await
            {
                Ok(media_resp) => {
                    media_refs.push(json!({
                        "uri": media_resp.uri.to_string(),
                        "cid": media_resp.cid.as_ref().to_string(),
                    }));
                }
                Err(e) => {
                    warn!(error = ?e, "Failed to create media record");
                }
            }
        }
    }

    let now = Datetime::now();
    let now_rfc3339 = now.as_str().to_string();
    let event_date_str = body.event_date.as_deref().unwrap_or(&now_rfc3339);
    let event_date: Datetime = event_date_str
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid eventDate format".into()))?;

    // Build occurrence record with only schema fields (bio.lexicons.temp.occurrence)
    let record_value = {
        let lat_str: jacquard_common::CowStr<'_> = body.latitude.to_string().into();
        let lng_str: jacquard_common::CowStr<'_> = body.longitude.to_string().into();
        let record = Occurrence::new()
            .decimal_latitude(lat_str)
            .decimal_longitude(lng_str)
            .coordinate_uncertainty_in_meters(
                body.coordinate_uncertainty_in_meters
                    .unwrap_or(constants::DEFAULT_COORDINATE_UNCERTAINTY) as i64,
            )
            .event_date(event_date)
            .build();

        let mut rv = auth::serialize_at_record(&record)?;

        if !media_refs.is_empty() {
            rv["associatedMedia"] = json!(media_refs);
        }

        rv
    };

    // Clone record_value before it's consumed by create_record
    let record_value_for_db = record_value.clone();

    // Create AT Protocol record
    let resp = auth::create_at_record(&agent, did_parsed, Occurrence::NSID, record_value).await?;

    let uri = resp.uri.to_string();
    let cid = resp.cid.as_ref().to_string();

    info!(uri = %uri, "Created occurrence");

    // Immediate DB upsert for visibility — uses the same shared conversion
    // as the ingester so field mapping is always consistent.
    if let Ok(mut parsed) = observing_db::processing::occurrence_from_json(
        &record_value_for_db,
        uri.clone(),
        cid.clone(),
        user.did.clone(),
    ) {
        // Set blob entries directly — the PDS record uses associatedMedia (strong refs)
        // but the DB stores blob entries for efficient image serving.
        if !blob_entries.is_empty() {
            parsed.params.associated_media = Some(json!(blob_entries));
        }
        parsed.params.created_at = Utc::now();
        if let Err(e) = observing_db::occurrences::upsert(&state.pool, &parsed.params).await {
            warn!(error = %e, "Failed to upsert occurrence into local DB");
        }
    }

    // Save private location data
    if let Err(e) =
        observing_db::private_data::save(&state.pool, &uri, body.latitude, body.longitude, "open")
            .await
    {
        warn!(error = %e, "Failed to save private location data");
    }

    // Sync observers
    let co_observers = body.recorded_by.unwrap_or_default();
    if let Err(e) = observing_db::observers::sync(&state.pool, &uri, &user.did, &co_observers).await
    {
        warn!(error = %e, "Failed to sync observers");
    }

    // Auto-create first identification if a scientific name was provided
    if let Some(ref scientific_name) = body.scientific_name {
        if !scientific_name.is_empty() {
            let id_value =
                auto_id::build_identification_record(&state, scientific_name, &uri, &cid).await?;

            let id_value_for_db = id_value.clone();

            let id_did = atrium_api::types::string::Did::new(user.did.clone())
                .map_err(|e| AppError::Internal(format!("Invalid DID: {e}")))?;
            match auth::create_at_record(&agent, id_did, auto_id::identification_nsid(), id_value)
                .await
            {
                Ok(id_resp) => {
                    info!(uri = %id_resp.uri, "Auto-created identification for occurrence");
                    // Immediate DB sync for the identification
                    if let Ok(params) = observing_db::processing::identification_from_json(
                        &id_value_for_db,
                        id_resp.uri.to_string(),
                        id_resp.cid.as_ref().to_string(),
                        user.did.clone(),
                        chrono::Utc::now(),
                    ) {
                        if let Err(e) =
                            observing_db::identifications::upsert(&state.pool, &params).await
                        {
                            warn!(error = %e, "Failed to upsert auto-created identification into local DB");
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(error = ?e, "Failed to auto-create identification");
                }
            }
        }
    }

    Ok(Json(RecordCreatedResponse {
        success: true,
        uri,
        cid,
    }))
}

/// POST catch-all for /api/occurrences/{*uri} -- dispatches observers POST
pub async fn post_occurrence_catch_all(
    State(state): State<AppState>,
    user: AuthUser,
    Path(full_path): Path<String>,
    Json(body): Json<AddObserverRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    if let Some(uri) = full_path.strip_suffix("/observers") {
        if let Err(e) = observing_db::observers::add(&state.pool, uri, &user.did, "owner").await {
            warn!(error = %e, "Failed to add owner observer");
        }
        if let Err(e) =
            observing_db::observers::add(&state.pool, uri, &body.did, "co-observer").await
        {
            warn!(error = %e, "Failed to add co-observer");
        }
        return Ok(Json(SuccessResponse { success: true }));
    }

    Err(AppError::NotFound("Not found".into()))
}

/// DELETE catch-all for /api/occurrences/{*uri} -- dispatches occurrence delete or observer remove
pub async fn delete_occurrence_catch_all(
    State(state): State<AppState>,
    user: AuthUser,
    Path(full_path): Path<String>,
) -> Result<Json<SuccessResponse>, AppError> {
    // Try observer removal: path contains /observers/{did}
    if full_path.contains("/observers/") {
        let idx = full_path.rfind("/observers/").unwrap();
        let uri = &full_path[..idx];
        let observer_did = &full_path[idx + "/observers/".len()..];
        if let Err(e) = observing_db::observers::remove(&state.pool, uri, observer_did).await {
            warn!(error = %e, "Failed to remove observer");
        }
        return Ok(Json(SuccessResponse { success: true }));
    }

    // Otherwise, delete the occurrence itself
    let uri = &full_path;

    let at_uri = AtUri::parse(uri).ok_or_else(|| AppError::BadRequest("Invalid AT URI".into()))?;

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

    if let Err(e) = observing_db::occurrences::delete(&state.pool, uri).await {
        warn!(error = %e, "Failed to delete occurrence from local DB");
    }

    Ok(Json(SuccessResponse { success: true }))
}
