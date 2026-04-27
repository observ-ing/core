use atrium_api::types::{BlobRef as AtriumBlobRef, TypedBlobRef};
use axum::extract::{Path, State};
use axum::Json;
use jacquard_common::deps::smol_str::SmolStr;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::Datetime;
use observing_db::types::{BlobEntry, BlobImage, BlobRef as DbBlobRef};
use observing_lexicons::bio_lexicons::temp::media::MediaRecord;
use observing_lexicons::bio_lexicons::temp::occurrence::{Occurrence, OccurrenceRecord};
use observing_lexicons::com_atproto::repo::strong_ref::StrongRef;
use serde::Deserialize;
use serde_json::json;
use tracing::{info, warn};
use ts_rs::TS;

use crate::auth::{self, AuthUser};
use crate::constants;
use crate::error::AppError;
use crate::responses::{RecordCreatedResponse, SuccessResponse};
use crate::state::{AgentType, AppState};
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
pub struct UpdateOccurrenceRequest {
    uri: String,
    latitude: f64,
    longitude: f64,
    #[ts(optional)]
    coordinate_uncertainty_in_meters: Option<i32>,
    #[ts(optional)]
    event_date: Option<String>,
    /// Newly-added images to upload and attach, in addition to any retained ones.
    #[ts(optional)]
    images: Option<Vec<ImageUpload>>,
    /// Blob CIDs of existing media records to retain on the updated occurrence.
    /// Media whose CID is not in this list is dropped from the record.
    #[ts(optional)]
    retained_blob_cids: Option<Vec<String>>,
    #[ts(optional)]
    recorded_by: Option<Vec<String>>,
    #[ts(optional)]
    scientific_name: Option<String>,
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

    // Upload blobs and create media records on the PDS. The DB row will be
    // populated by the ingester when the firehose commit arrives; the
    // ingester resolves associatedMedia strong refs back into blob entries
    // for the `associated_media` column.
    let (_blob_entries, media_refs) =
        upload_media_records(&agent, &user.did, body.images.as_deref().unwrap_or(&[])).await?;

    let record_value = build_occurrence_record_json(
        body.latitude,
        body.longitude,
        body.coordinate_uncertainty_in_meters,
        body.event_date.as_deref(),
        None,
        media_refs,
        body.recorded_by.as_deref(),
    )?;

    // Create AT Protocol record. The firehose event that follows will trigger
    // observing-ingester to parse the same record into DB rows — we no longer
    // do that here, so there is a single writer for the occurrences,
    // occurrence_observers, and associated media state.
    let resp =
        auth::create_at_record(&agent, did_parsed, OccurrenceRecord::NSID, record_value).await?;

    let uri = resp.uri.to_string();
    let cid = resp.cid.as_ref().to_string();

    info!(uri = %uri, "Created occurrence (PDS); awaiting ingester for DB row");

    // Private location data is intentionally never written to the PDS, so the
    // ingester has no path to populate it. This is still the appview's job.
    if let Err(e) =
        observing_db::private_data::save(&state.pool, &uri, body.latitude, body.longitude, "open")
            .await
    {
        warn!(error = %e, "Failed to save private location data");
    }

    // Auto-create first identification if a scientific name was provided
    if let Some(ref scientific_name) = body.scientific_name {
        if !scientific_name.is_empty() {
            create_auto_identification(&state, &agent, &user.did, scientific_name, &uri, &cid)
                .await?;
        }
    }

    Ok(Json(RecordCreatedResponse {
        success: true,
        uri,
        cid,
    }))
}

/// DELETE /api/occurrences/{*uri} — delete an occurrence record via PDS deleteRecord.
pub async fn delete_occurrence(
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

    // The firehose delete commit will trigger the ingester to remove the row
    // (and cascade to identifications/comments/likes/interactions via FK).
    Ok(Json(SuccessResponse { success: true }))
}

/// PUT /api/occurrences — update an existing occurrence record via putRecord.
pub async fn update_occurrence(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<UpdateOccurrenceRequest>,
) -> Result<Json<RecordCreatedResponse>, AppError> {
    // Validate coordinates
    if !(-90.0..=90.0).contains(&body.latitude) || !(-180.0..=180.0).contains(&body.longitude) {
        return Err(AppError::BadRequest("Invalid coordinates".into()));
    }

    // Parse AT URI and enforce ownership / collection match
    let at_uri =
        AtUri::parse(&body.uri).ok_or_else(|| AppError::BadRequest("Invalid AT URI".into()))?;
    if at_uri.did != user.did {
        return Err(AppError::Forbidden(
            "You can only edit your own records".into(),
        ));
    }
    if at_uri.collection != OccurrenceRecord::NSID {
        return Err(AppError::BadRequest(
            "URI does not reference an occurrence record".into(),
        ));
    }

    let collection_nsid: atrium_api::types::string::Nsid = at_uri
        .collection
        .parse()
        .map_err(|e| AppError::Internal(format!("Invalid collection: {e}")))?;
    let rkey_parsed: atrium_api::types::string::RecordKey = at_uri
        .rkey
        .parse()
        .map_err(|e| AppError::Internal(format!("Invalid rkey: {e}")))?;

    let (agent, did_parsed) = auth::require_agent(&state.oauth_client, &user.did).await?;

    // Fetch existing PDS record so we can preserve retained associatedMedia strong refs
    let existing = agent
        .api
        .com
        .atproto
        .repo
        .get_record(
            atrium_api::com::atproto::repo::get_record::ParametersData {
                cid: None,
                collection: collection_nsid.clone(),
                repo: atrium_api::types::string::AtIdentifier::Did(did_parsed.clone()),
                rkey: rkey_parsed.clone(),
            }
            .into(),
        )
        .await
        .map_err(|e| {
            if matches!(e, atrium_api::xrpc::Error::Authentication(_)) {
                tracing::warn!(error = %e, "AT Protocol authentication failed (session expired)");
                AppError::Unauthorized
            } else {
                AppError::Internal(format!("Failed to fetch record: {e}"))
            }
        })?;

    let existing_value: serde_json::Value = serde_json::to_value(&existing.value)
        .map_err(|e| AppError::Internal(format!("Failed to serialize existing record: {e}")))?;
    let existing_media_refs = existing_value
        .get("associatedMedia")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let existing_created_at = existing_value
        .get("createdAt")
        .and_then(|v| v.as_str())
        .map(str::to_owned);

    // Load the local DB row: its blob_entries are index-aligned with the PDS
    // associatedMedia strong refs (both are written together by create_occurrence),
    // which lets us map blob CIDs → strong refs without a per-media fetch.
    let existing_db_row = observing_db::occurrences::get(&state.pool, &body.uri)
        .await?
        .ok_or_else(|| AppError::NotFound("Occurrence not found".into()))?;
    let existing_blobs = existing_db_row.blob_entries();

    let retained_cids = body.retained_blob_cids.clone().unwrap_or_default();

    let mut media_refs: Vec<StrongRef> = Vec::new();

    if existing_media_refs.len() == existing_blobs.len() {
        for (i, blob) in existing_blobs.iter().enumerate() {
            let blob_cid = blob.image.ref_.cid();
            if retained_cids.iter().any(|cid| cid == blob_cid) {
                match serde_json::from_value::<StrongRef>(existing_media_refs[i].clone()) {
                    Ok(strong_ref) => media_refs.push(strong_ref),
                    Err(e) => {
                        warn!(error = %e, "Failed to parse existing strong ref; dropping");
                    }
                }
            }
        }
    } else {
        warn!(
            uri = %body.uri,
            pds_count = existing_media_refs.len(),
            db_count = existing_blobs.len(),
            "Mismatch between PDS associatedMedia and DB blob_entries; dropping retained media"
        );
    }

    // Upload new images and append their strong refs to what was retained
    let (_new_blob_entries, new_media_refs) =
        upload_media_records(&agent, &user.did, body.images.as_deref().unwrap_or(&[])).await?;
    media_refs.extend(new_media_refs);

    let record_value = build_occurrence_record_json(
        body.latitude,
        body.longitude,
        body.coordinate_uncertainty_in_meters,
        body.event_date.as_deref(),
        existing_created_at.as_deref(),
        media_refs,
        body.recorded_by.as_deref(),
    )?;

    // putRecord on the PDS. The firehose commit that follows triggers the
    // ingester to refresh the occurrence row and observer links — the appview
    // no longer writes directly to those tables, mirroring the create flow.
    let resp = agent
        .api
        .com
        .atproto
        .repo
        .put_record(
            atrium_api::com::atproto::repo::put_record::InputData {
                collection: collection_nsid,
                record: serde_json::from_value(record_value)
                    .map_err(|e| AppError::Internal(format!("Failed to convert record: {e}")))?,
                repo: atrium_api::types::string::AtIdentifier::Did(did_parsed),
                rkey: rkey_parsed,
                swap_commit: None,
                swap_record: None,
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
                AppError::Internal(format!("Failed to put record: {e}"))
            }
        })?;

    let uri = resp.uri.clone();
    let cid = resp.cid.as_ref().to_string();

    info!(uri = %uri, "Updated occurrence (PDS); awaiting ingester for DB refresh");

    // Private location data is intentionally never written to the PDS, so the
    // ingester has no path to populate it. This is still the appview's job.
    if let Err(e) =
        observing_db::private_data::save(&state.pool, &uri, body.latitude, body.longitude, "open")
            .await
    {
        warn!(error = %e, "Failed to save private location data");
    }

    // If a scientific name was provided and no existing identification from this
    // user already matches, auto-create a new identification (mirrors create flow).
    if let Some(ref scientific_name) = body.scientific_name {
        let trimmed = scientific_name.trim();
        if !trimmed.is_empty() {
            let existing_ids = observing_db::identifications::get_for_occurrence(&state.pool, &uri)
                .await
                .unwrap_or_default();
            let already_identified = existing_ids
                .iter()
                .any(|id| id.did == user.did && id.scientific_name == trimmed);
            if !already_identified {
                create_auto_identification(&state, &agent, &user.did, trimmed, &uri, &cid).await?;
            }
        }
    }

    Ok(Json(RecordCreatedResponse {
        success: true,
        uri,
        cid,
    }))
}

/// Upload each image as a blob, create a `bio.lexicons.temp.media` record per
/// blob, and return parallel `(blob_entries, media_refs)` vecs. The DB stores
/// blob entries for efficient image serving; the PDS occurrence record stores
/// strong refs to the media records under `associatedMedia`. Media-record
/// creation failures are logged and skipped (blob already uploaded is retained
/// in DB).
async fn upload_media_records(
    agent: &AgentType,
    user_did: &str,
    images: &[ImageUpload],
) -> Result<(Vec<BlobEntry>, Vec<StrongRef>), AppError> {
    use base64::Engine;

    let mut blob_entries = Vec::with_capacity(images.len());
    let mut media_refs = Vec::with_capacity(images.len());

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

        // Destructure atrium's BlobRef to build the DB BlobEntry with concrete types.
        let (cid_str, mime_type) = match &blob_resp.blob {
            AtriumBlobRef::Typed(TypedBlobRef::Blob(blob)) => {
                (blob.r#ref.0.to_string(), blob.mime_type.clone())
            }
            AtriumBlobRef::Untyped(u) => (u.cid.clone(), u.mime_type.clone()),
        };
        blob_entries.push(BlobEntry {
            image: BlobImage {
                ref_: DbBlobRef::Link { link: cid_str },
                mime_type,
            },
            alt: None,
        });

        // The media record still uses the raw atrium BlobRef value, which
        // serializes to the `{"$type": "blob", ref, mimeType, size}` shape
        // the PDS requires. Building the typed Media lexicon struct would
        // require converting atrium's BlobRef into jacquard's distinct
        // BlobRef type, so we stay in JSON for this single field.
        let blob_value = serde_json::to_value(&blob_resp.blob)
            .map_err(|e| AppError::Internal(format!("Failed to serialize blob: {e}")))?;
        let media_record_value = json!({
            "$type": MediaRecord::NSID,
            "image": blob_value,
        });
        let did_for_media = atrium_api::types::string::Did::new(user_did.to_string())
            .map_err(|e| AppError::Internal(format!("Invalid DID: {e}")))?;
        match auth::create_at_record(agent, did_for_media, MediaRecord::NSID, media_record_value)
            .await
        {
            Ok(media_resp) => {
                let media_uri = media_resp.uri.to_string();
                let media_cid = media_resp.cid.as_ref().to_string();
                match auth::build_strong_ref(&media_uri, &media_cid) {
                    Ok(strong_ref) => media_refs.push(strong_ref),
                    Err(e) => warn!(error = ?e, "Failed to build strong ref for media record"),
                }
            }
            Err(e) => {
                warn!(error = ?e, "Failed to create media record");
            }
        }
    }

    Ok((blob_entries, media_refs))
}

/// Build the `bio.lexicons.temp.occurrence` record body (schema fields only)
/// and serialize it to JSON for the PDS write API. `media_refs` are attached
/// via the typed builder's `associatedMedia` field. Defaults `eventDate` to now.
///
/// `recorded_by` is serialized as the extension field `recordedBy` — it is
/// not part of the `bio.lexicons.temp.occurrence` schema, but the ingester
/// reads it back out of the raw record JSON to populate `occurrence_observers`.
///
/// `createdAt` is also injected as an extension field — the ingester uses it
/// for feed ordering. On edit, pass the existing record's `createdAt` so the
/// post doesn't get bumped to the top of feeds.
fn build_occurrence_record_json(
    latitude: f64,
    longitude: f64,
    coordinate_uncertainty_in_meters: Option<i32>,
    event_date: Option<&str>,
    created_at: Option<&str>,
    media_refs: Vec<StrongRef>,
    recorded_by: Option<&[String]>,
) -> Result<serde_json::Value, AppError> {
    let now = Datetime::now();
    let now_rfc3339 = now.as_str().to_string();
    let event_date_str = event_date.unwrap_or(&now_rfc3339);
    let event_date: Datetime = event_date_str
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid eventDate format".into()))?;

    let associated_media = if media_refs.is_empty() {
        None
    } else {
        Some(media_refs)
    };

    let record = Occurrence::new()
        .decimal_latitude(SmolStr::from(latitude.to_string()))
        .decimal_longitude(SmolStr::from(longitude.to_string()))
        .coordinate_uncertainty_in_meters(
            coordinate_uncertainty_in_meters.unwrap_or(constants::DEFAULT_COORDINATE_UNCERTAINTY)
                as i64,
        )
        .event_date(event_date)
        .maybe_associated_media(associated_media)
        .build();

    let mut value = auth::serialize_at_record(&record)?;
    if let Some(obj) = value.as_object_mut() {
        let created_at_str = created_at.map(str::to_owned).unwrap_or(now_rfc3339);
        obj.insert("createdAt".to_string(), json!(created_at_str));
        if let Some(dids) = recorded_by {
            let filtered: Vec<&String> = dids.iter().filter(|d| !d.is_empty()).collect();
            if !filtered.is_empty() {
                obj.insert("recordedBy".to_string(), json!(filtered));
            }
        }
    }
    Ok(value)
}

/// Create an identification record on the PDS for the given occurrence. The
/// row in `identifications` is populated by the ingester when the firehose
/// event lands, so this function no longer writes directly to the local DB.
/// Jetstream delivers commits in repo order, so the preceding occurrence
/// upsert (needed to satisfy the FK on `identifications.subject_uri`) is
/// guaranteed to run first.
async fn create_auto_identification(
    state: &AppState,
    agent: &AgentType,
    user_did: &str,
    scientific_name: &str,
    occurrence_uri: &str,
    occurrence_cid: &str,
) -> Result<(), AppError> {
    let id_value = auto_id::build_identification_record(
        state,
        scientific_name,
        occurrence_uri,
        occurrence_cid,
    )
    .await?;
    let id_did = atrium_api::types::string::Did::new(user_did.to_string())
        .map_err(|e| AppError::Internal(format!("Invalid DID: {e}")))?;
    match auth::create_at_record(agent, id_did, auto_id::identification_nsid(), id_value).await {
        Ok(id_resp) => {
            info!(uri = %id_resp.uri, "Auto-created identification (PDS); awaiting ingester");
        }
        Err(e) => {
            warn!(error = ?e, "Failed to auto-create identification");
        }
    }
    Ok(())
}
