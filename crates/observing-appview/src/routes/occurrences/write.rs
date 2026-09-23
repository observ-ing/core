use atrium_api::types::{BlobRef as AtriumBlobRef, TypedBlobRef};
use axum::extract::{Path, State};
use axum::Json;
use jacquard_common::deps::smol_str::SmolStr;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::Datetime;
use jacquard_common::types::uri::UriValue;
use observing_db::types::{BlobEntry, BlobImage, BlobRef as DbBlobRef};
use observing_lexicons::bio_lexicons::temp::v0_1::media::MediaRecord;
use observing_lexicons::bio_lexicons::temp::v0_1::occurrence::{
    ExternalRecord, ExternalRecordService, Occurrence, OccurrenceOrganismQuantityType,
    OccurrenceRecord,
};
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
use crate::validation::validate_license;
use jacquard_common::types::string::AtUri;
use std::str::FromStr;

use super::auto_id;

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct CreateOccurrenceRequest {
    latitude: f64,
    longitude: f64,
    #[ts(optional)]
    coordinate_uncertainty_in_meters: Option<i32>,
    /// Darwin Core dwc:organismQuantity — free text (a count, a range like
    /// "10-100", or a categorical value like "many"). Written verbatim.
    #[ts(optional)]
    organism_quantity: Option<String>,
    /// Darwin Core dwc:organismQuantityType — the quantification system the
    /// quantity uses ("individuals", "percent-cover", or an open-vocab value).
    #[ts(optional)]
    organism_quantity_type: Option<String>,
    #[ts(optional)]
    event_date: Option<String>,
    /// References to this same occurrence held on another service. Capped at
    /// `constants::MAX_EXTERNAL_RECORDS` by the lexicon.
    #[ts(optional)]
    external_records: Option<Vec<ExternalRecordInput>>,
    #[ts(optional)]
    images: Option<Vec<ImageUpload>>,
    /// License URI applied to each uploaded media record (e.g.
    /// `https://creativecommons.org/licenses/by/4.0/`). Validated against
    /// `validation::ALLOWED_LICENSES`; a retired SPDX identifier is upgraded to
    /// its URI rather than rejected. When omitted, the PDS media record stores
    /// no license.
    #[ts(optional)]
    license: Option<String>,
    #[ts(optional)]
    scientific_name: Option<String>,
    #[ts(optional)]
    taxon_rank: Option<String>,
    /// Optional kingdom hint from a GBIF autocomplete pick. Disambiguates
    /// genus-level names for the auto-identification's GBIF validate call
    /// and acts as a fallback when validation doesn't return a kingdom.
    #[ts(optional)]
    kingdom: Option<String>,
    /// Stable taxon URI from a GBIF autocomplete pick (e.g. a GBIF species
    /// URI). Written to the auto-created identification's `taxonID` field.
    #[ts(optional)]
    taxon_id: Option<String>,
}

/// One `externalRecords` entry from the submit/edit form: this same occurrence
/// as held by another service. Both create and update send the full list, so an
/// edit round-trips whatever the form was populated with.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct ExternalRecordInput {
    /// Permalink of the record on the holding service, or an `at://` URI for a
    /// record in another AT Protocol lexicon.
    uri: String,
    /// Short service identifier (`inaturalist`, `bugguide`, an app name).
    /// Optional — the client derives it from the URI host where it recognizes
    /// one, and omits it otherwise rather than guessing.
    #[ts(optional)]
    service: Option<String>,
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
    /// See `CreateOccurrenceRequest::organism_quantity`. Omitting it clears the
    /// value on the record, so the edit form sends back the existing value.
    #[ts(optional)]
    organism_quantity: Option<String>,
    /// See `CreateOccurrenceRequest::organism_quantity_type`.
    #[ts(optional)]
    organism_quantity_type: Option<String>,
    #[ts(optional)]
    event_date: Option<String>,
    /// See `CreateOccurrenceRequest::external_records`. The edit form sends the
    /// full list back, so omitting it clears the entries on the record.
    #[ts(optional)]
    external_records: Option<Vec<ExternalRecordInput>>,
    /// Newly-added images to upload and attach, in addition to any retained ones.
    #[ts(optional)]
    images: Option<Vec<ImageUpload>>,
    /// Blob CIDs of existing media records to retain on the updated occurrence.
    /// Media whose CID is not in this list is dropped from the record.
    #[ts(optional)]
    retained_blob_cids: Option<Vec<String>>,
    /// License URI to apply to *newly-uploaded* media records on this edit.
    /// Retained media keep whatever license they were originally written with —
    /// silently rewriting historical metadata when a default changes would lose
    /// the user's intent at upload time.
    #[ts(optional)]
    license: Option<String>,
    #[ts(optional)]
    scientific_name: Option<String>,
    #[ts(optional)]
    taxon_rank: Option<String>,
    /// See `CreateOccurrenceRequest::kingdom`.
    #[ts(optional)]
    kingdom: Option<String>,
    /// See `CreateOccurrenceRequest::taxon_id`.
    #[ts(optional)]
    taxon_id: Option<String>,
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

    let license = match body.license {
        Some(ref license) => Some(validate_license(license)?),
        None => None,
    };

    // Restore OAuth session for AT Protocol operations
    let (agent, did_parsed) = auth::require_agent(&state.oauth_client, &user.did).await?;

    // Upload blobs and create media records on the PDS. The DB row will be
    // populated by the ingester when the firehose commit arrives; the
    // ingester resolves associatedMedia strong refs back into blob entries
    // for the `associated_media` column.
    let (_blob_entries, media_refs) = upload_media_records(
        &agent,
        &user.did,
        body.images.as_deref().unwrap_or(&[]),
        license,
    )
    .await?;

    let record_value = build_occurrence_record_json(OccurrenceRecordFields {
        latitude: body.latitude,
        longitude: body.longitude,
        coordinate_uncertainty_in_meters: body.coordinate_uncertainty_in_meters,
        organism_quantity: body.organism_quantity.as_deref(),
        organism_quantity_type: body.organism_quantity_type.as_deref(),
        event_date: body.event_date.as_deref(),
        external_records: body.external_records.as_deref(),
        media_refs,
    })?;

    // Create AT Protocol record. The firehose event that follows will trigger
    // observing-ingester to parse the same record into DB rows — we no longer
    // do that here, so there is a single writer for the occurrences and
    // associated media state.
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
            create_auto_identification(
                &state,
                &agent,
                &user.did,
                scientific_name,
                body.taxon_rank.as_deref(),
                body.kingdom.as_deref(),
                body.taxon_id.as_deref(),
                &uri,
                &cid,
            )
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

    let license = match body.license {
        Some(ref license) => Some(validate_license(license)?),
        None => None,
    };

    // Parse AT URI and enforce ownership / collection match
    let at_uri =
        AtUri::from_str(&body.uri).map_err(|_| AppError::BadRequest("Invalid AT URI".into()))?;
    if at_uri.authority().as_str() != user.did {
        return Err(AppError::Forbidden(
            "You can only edit your own records".into(),
        ));
    }
    if at_uri
        .collection()
        .is_none_or(|c| c.as_str() != OccurrenceRecord::NSID)
    {
        return Err(AppError::BadRequest(
            "URI does not reference an occurrence record".into(),
        ));
    }

    let (collection_nsid, rkey_parsed) = auth::parse_collection_and_rkey(&at_uri)?;

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
                match StrongRef::deserialize(&existing_media_refs[i]) {
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
    let (_new_blob_entries, new_media_refs) = upload_media_records(
        &agent,
        &user.did,
        body.images.as_deref().unwrap_or(&[]),
        license,
    )
    .await?;
    media_refs.extend(new_media_refs);

    let record_value = build_occurrence_record_json(OccurrenceRecordFields {
        latitude: body.latitude,
        longitude: body.longitude,
        coordinate_uncertainty_in_meters: body.coordinate_uncertainty_in_meters,
        organism_quantity: body.organism_quantity.as_deref(),
        organism_quantity_type: body.organism_quantity_type.as_deref(),
        event_date: body.event_date.as_deref(),
        external_records: body.external_records.as_deref(),
        media_refs,
    })?;

    // putRecord on the PDS. The firehose commit that follows triggers the
    // ingester to refresh the occurrence row — the appview no longer writes
    // directly to that table, mirroring the create flow.
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
                create_auto_identification(
                    &state,
                    &agent,
                    &user.did,
                    trimmed,
                    body.taxon_rank.as_deref(),
                    body.kingdom.as_deref(),
                    body.taxon_id.as_deref(),
                    &uri,
                    &cid,
                )
                .await?;
            }
        }
    }

    Ok(Json(RecordCreatedResponse {
        success: true,
        uri,
        cid,
    }))
}

/// Upload each image as a blob, create a `bio.lexicons.temp.v0-1.media` record per
/// blob, and return parallel `(blob_entries, media_refs)` vecs. The DB stores
/// blob entries for efficient image serving; the PDS occurrence record stores
/// strong refs to the media records under `associatedMedia`. Media-record
/// creation failures are logged and skipped (blob already uploaded is retained
/// in DB).
async fn upload_media_records(
    agent: &AgentType,
    user_did: &str,
    images: &[ImageUpload],
    license: Option<&str>,
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
            license: license.map(str::to_string),
        });

        // The media record still uses the raw atrium BlobRef value, which
        // serializes to the `{"$type": "blob", ref, mimeType, size}` shape
        // the PDS requires. Building the typed Media lexicon struct would
        // require converting atrium's BlobRef into jacquard's distinct
        // BlobRef type, so we stay in JSON for this single field.
        let blob_value = serde_json::to_value(&blob_resp.blob)
            .map_err(|e| AppError::Internal(format!("Failed to serialize blob: {e}")))?;
        let mut media_record_value = json!({
            "$type": MediaRecord::NSID,
            "image": blob_value,
        });
        if let Some(license) = license {
            media_record_value["license"] = serde_json::Value::String(license.to_string());
        }
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

/// The record fields both the create and the edit path assemble before writing.
/// Grouped into a struct rather than passed positionally so adding a field
/// doesn't turn the call sites into a row of same-typed `Option<&str>`s.
struct OccurrenceRecordFields<'a> {
    latitude: f64,
    longitude: f64,
    coordinate_uncertainty_in_meters: Option<i32>,
    organism_quantity: Option<&'a str>,
    organism_quantity_type: Option<&'a str>,
    event_date: Option<&'a str>,
    external_records: Option<&'a [ExternalRecordInput]>,
    media_refs: Vec<StrongRef>,
}

/// Build the `bio.lexicons.temp.v0-1.occurrence` record body and serialize it
/// to JSON for the PDS write API. `media_refs` are attached via the typed
/// builder's `associatedMedia` field. Defaults `eventDate` to now, and stamps a
/// `createdAt` field (the AT Protocol authoring time) so the firehose ingester
/// records when the post was authored on the PDS rather than when it was
/// ingested. `createdAt` is an app-specific extension, not part of the upstream
/// occurrence lexicon; see the matching handling in the identification path.
fn build_occurrence_record_json(
    fields: OccurrenceRecordFields<'_>,
) -> Result<serde_json::Value, AppError> {
    let OccurrenceRecordFields {
        latitude,
        longitude,
        coordinate_uncertainty_in_meters,
        organism_quantity,
        organism_quantity_type,
        event_date,
        external_records,
        media_refs,
    } = fields;
    let now = Datetime::now();
    let now_rfc3339 = now.as_str().to_string();
    let event_date_str = event_date.unwrap_or(&now_rfc3339);

    // Accept any Darwin Core eventDate the lexicon allows — a single date,
    // date-time, or interval (e.g. "1971", "1995-05-21/1995-05-23"). Validate
    // by expanding to a [start, end) range and reject only values we can't
    // recognize at all; the raw string is stored verbatim so ranges and
    // reduced precision round-trip to the PDS.
    if observing_db::processing::expand_event_date(event_date_str).is_none() {
        return Err(AppError::BadRequest("Invalid eventDate format".into()));
    }

    let media = if media_refs.is_empty() {
        None
    } else {
        Some(media_refs)
    };

    let external_records = match external_records {
        Some(inputs) => build_external_records(inputs)?,
        None => None,
    };

    let record = Occurrence::new()
        .decimal_latitude(SmolStr::from(latitude.to_string()))
        .decimal_longitude(SmolStr::from(longitude.to_string()))
        .coordinate_uncertainty_in_meters(
            coordinate_uncertainty_in_meters.unwrap_or(constants::DEFAULT_COORDINATE_UNCERTAINTY)
                as i64,
        )
        .event_date(SmolStr::from(event_date_str))
        .maybe_organism_quantity(
            organism_quantity
                .filter(|s| !s.is_empty())
                .map(SmolStr::from),
        )
        .maybe_organism_quantity_type(
            organism_quantity_type
                .filter(|s| !s.is_empty())
                .map(|s| OccurrenceOrganismQuantityType::from_value(SmolStr::from(s))),
        )
        .maybe_media(media)
        .maybe_external_records(external_records)
        .build();

    let mut record_value = auth::serialize_at_record(&record)?;

    // App-specific fields (not in upstream lexicon, stored as extra data in the
    // AT Protocol record). `createdAt` is the post authoring time; the ingester
    // reads it into `occurrences.created_at` (which the feed sorts by), falling
    // back to ingestion time only when it is absent.
    if let Some(obj) = record_value.as_object_mut() {
        obj.insert(
            "createdAt".to_string(),
            serde_json::json!(chrono::Utc::now().to_rfc3339()),
        );
    }

    Ok(record_value)
}

/// Validate the submitted external records and turn them into the lexicon's
/// `#externalRecord` entries, or `None` when nothing survives (an empty array
/// would be written to the PDS as a meaningless `[]`).
///
/// Every limit here mirrors the lexicon, so a record we accept is one the PDS
/// will too. Schemes are deliberately narrower than the lexicon's "any URI":
/// the entries are shown to readers as links, and http(s)/at are the only
/// schemes this app renders or that an occurrence permalink realistically
/// uses — anything else is more likely a mistake (or a `javascript:` payload)
/// than a record reference. Blank URIs are dropped rather than rejected, since
/// the edit form can submit a half-typed row, and duplicates collapse.
fn build_external_records(
    inputs: &[ExternalRecordInput],
) -> Result<Option<Vec<ExternalRecord>>, AppError> {
    let mut records: Vec<ExternalRecord> = Vec::new();
    let mut seen: Vec<&str> = Vec::new();

    for input in inputs {
        let uri = input.uri.trim();
        if uri.is_empty() {
            continue;
        }
        if uri.len() > constants::MAX_EXTERNAL_RECORD_URI_LENGTH {
            return Err(AppError::BadRequest(format!(
                "External record URI must be at most {} characters",
                constants::MAX_EXTERNAL_RECORD_URI_LENGTH
            )));
        }
        if !is_supported_external_record_uri(uri) {
            return Err(AppError::BadRequest(format!(
                "External record URI must start with http://, https://, or at:// — got: {uri}"
            )));
        }
        if seen.contains(&uri) {
            continue;
        }
        seen.push(uri);

        let service = input
            .service
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if let Some(service) = service {
            if service.len() > constants::MAX_EXTERNAL_RECORD_SERVICE_LENGTH {
                return Err(AppError::BadRequest(format!(
                    "External record service must be at most {} characters",
                    constants::MAX_EXTERNAL_RECORD_SERVICE_LENGTH
                )));
            }
        }

        if records.len() == constants::MAX_EXTERNAL_RECORDS {
            return Err(AppError::BadRequest(format!(
                "At most {} external records are allowed",
                constants::MAX_EXTERNAL_RECORDS
            )));
        }

        let parsed_uri = UriValue::new_owned(uri)
            .map_err(|_| AppError::BadRequest(format!("Invalid external record URI: {uri}")))?;

        records.push(
            ExternalRecord::new()
                .uri(parsed_uri)
                .maybe_service(service.map(|s| ExternalRecordService::from_value(SmolStr::from(s))))
                .build(),
        );
    }

    Ok((!records.is_empty()).then_some(records))
}

/// Whether a URI is one this app is willing to write as an external record.
/// See `build_external_records` for why the set is narrower than the lexicon's.
fn is_supported_external_record_uri(uri: &str) -> bool {
    ["http://", "https://", "at://"]
        .iter()
        .any(|scheme| uri.len() > scheme.len() && uri[..scheme.len()].eq_ignore_ascii_case(scheme))
}

/// Create an identification record on the PDS for the given occurrence. The
/// row in `identifications` is populated by the ingester when the firehose
/// event lands, so this function no longer writes directly to the local DB.
/// Jetstream delivers commits in repo order, so the preceding occurrence
/// upsert (needed to satisfy the FK on `identifications.subject_uri`) is
/// guaranteed to run first.
#[allow(clippy::too_many_arguments)]
async fn create_auto_identification(
    state: &AppState,
    agent: &AgentType,
    user_did: &str,
    scientific_name: &str,
    user_taxon_rank: Option<&str>,
    user_kingdom: Option<&str>,
    user_taxon_id: Option<&str>,
    occurrence_uri: &str,
    occurrence_cid: &str,
) -> Result<(), AppError> {
    let id_value = auto_id::build_identification_record(
        state,
        scientific_name,
        user_taxon_rank,
        user_kingdom,
        user_taxon_id,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn input(uri: &str, service: Option<&str>) -> ExternalRecordInput {
        ExternalRecordInput {
            uri: uri.to_string(),
            service: service.map(str::to_string),
        }
    }

    /// The record the PDS receives carries the entries verbatim, with the
    /// service mapped onto the lexicon's known values where it matches one.
    #[test]
    fn builds_entries_with_and_without_a_service() {
        let records = build_external_records(&[
            input(
                "https://www.inaturalist.org/observations/123456789",
                Some("inaturalist"),
            ),
            input(
                "at://did:plc:other/app.gainforest.dwc.occurrence/3mu2",
                None,
            ),
        ])
        .expect("valid entries")
        .expect("some entries");

        assert_eq!(records.len(), 2);
        assert_eq!(
            records[0].uri.as_str(),
            "https://www.inaturalist.org/observations/123456789"
        );
        assert_eq!(
            records[0].service,
            Some(ExternalRecordService::Inaturalist),
            "a known value maps onto the enum variant rather than Other"
        );
        assert_eq!(records[1].service, None);
    }

    /// An unfamiliar service identifier is kept as-is: the lexicon says its
    /// known values are not exhaustive.
    #[test]
    fn keeps_an_unknown_service_verbatim() {
        let records = build_external_records(&[input(
            "https://observation.org/observation/1",
            Some("observation-org"),
        )])
        .expect("valid entry")
        .expect("some entries");

        assert_eq!(
            records[0].service,
            Some(ExternalRecordService::Other("observation-org".into()))
        );
    }

    /// Nothing to write must stay absent rather than becoming `[]` on the
    /// record — an empty array is noise every reader would have to special-case.
    #[test]
    fn empty_input_produces_no_field() {
        assert!(build_external_records(&[]).expect("valid").is_none());
        assert!(build_external_records(&[input("   ", None)])
            .expect("blank rows are dropped, not rejected")
            .is_none());
    }

    /// A half-typed row from the edit form shouldn't fail the whole save, and
    /// the same link added twice collapses.
    #[test]
    fn drops_blanks_and_duplicates() {
        let records = build_external_records(&[
            input("https://bugguide.net/node/view/1", Some("bugguide")),
            input("", None),
            input("  https://bugguide.net/node/view/1  ", Some("bugguide")),
        ])
        .expect("valid entries")
        .expect("some entries");

        assert_eq!(records.len(), 1);
    }

    /// Both limits mirror the lexicon: exceeding either would have the PDS
    /// reject the whole record, so we fail early with a readable message.
    #[test]
    fn rejects_more_than_the_lexicon_allows() {
        let inputs: Vec<ExternalRecordInput> = (0..=constants::MAX_EXTERNAL_RECORDS)
            .map(|i| input(&format!("https://example.org/observations/{i}"), None))
            .collect();

        assert!(matches!(
            build_external_records(&inputs).expect_err("over the cap"),
            AppError::BadRequest(_)
        ));
    }

    #[test]
    fn rejects_an_over_long_uri() {
        let uri = format!(
            "https://example.org/{}",
            "a".repeat(constants::MAX_EXTERNAL_RECORD_URI_LENGTH)
        );
        assert!(matches!(
            build_external_records(&[input(&uri, None)]).expect_err("over the cap"),
            AppError::BadRequest(_)
        ));
    }

    /// Schemes outside http(s)/at are refused: the reader never renders them
    /// as a link, and `javascript:` has no business on a record.
    #[test]
    fn rejects_unsupported_schemes() {
        for uri in [
            "javascript:alert(1)",
            "data:text/html,hi",
            "www.inaturalist.org/observations/1",
            "ftp://example.org/1",
        ] {
            assert!(
                matches!(
                    build_external_records(&[input(uri, None)]),
                    Err(AppError::BadRequest(_))
                ),
                "{uri} should be rejected"
            );
        }
    }

    /// Scheme matching is case-insensitive, as URI schemes are.
    #[test]
    fn accepts_an_uppercase_scheme() {
        assert!(
            build_external_records(&[input("HTTPS://example.org/1", None)])
                .expect("valid entry")
                .is_some()
        );
    }
}
