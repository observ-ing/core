use axum::extract::{Path, State};
use axum::Json;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::Datetime;
use observing_lexicons::org_rwell::test::occurrence::{Location, Occurrence};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;
use ts_rs::TS;

use crate::auth;
use crate::error::AppError;
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
    notes: Option<String>,
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
    // Deserialized from frontend but not sent to PDS — atrium's upload_blob
    // uses */* encoding and the PDS infers the MIME type from the bytes.
    #[allow(dead_code)]
    mime_type: String,
}

pub async fn create_occurrence(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Json(body): Json<CreateOccurrenceRequest>,
) -> Result<Json<Value>, AppError> {
    let user = auth::require_auth(&state.pool, &cookies)
        .await
        .map_err(|_| AppError::Unauthorized)?;

    // Validate coordinates
    if !(-90.0..=90.0).contains(&body.latitude) || !(-180.0..=180.0).contains(&body.longitude) {
        return Err(AppError::BadRequest("Invalid coordinates".into()));
    }

    // Restore OAuth session for AT Protocol operations
    let did_parsed = atrium_api::types::string::Did::new(user.did.clone())
        .map_err(|e| AppError::Internal(format!("Invalid DID: {e}")))?;
    let session = state.oauth_client.restore(&did_parsed).await.map_err(|e| {
        tracing::warn!(error = %e, "Failed to restore OAuth session");
        AppError::Unauthorized
    })?;
    let agent = atrium_api::agent::Agent::new(session);

    // Upload blobs
    let mut blobs = Vec::new();
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
            blobs.push(json!({ "image": blob_value, "alt": "" }));
        }
    }

    // Reverse geocode
    let geo = state
        .geocoding
        .reverse_geocode(body.latitude, body.longitude)
        .await
        .ok();

    let now = Datetime::now();
    let now_rfc3339 = now.as_str().to_string();
    let event_date_str = body.event_date.as_deref().unwrap_or(&now_rfc3339);
    let event_date: Datetime = event_date_str
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid eventDate format".into()))?;

    // Build location using typed Location struct
    let location = Location {
        decimal_latitude: body.latitude.to_string().into(),
        decimal_longitude: body.longitude.to_string().into(),
        coordinate_uncertainty_in_meters: Some(
            body.coordinate_uncertainty_in_meters.unwrap_or(50) as i64
        ),
        geodetic_datum: Some("WGS84".into()),
        continent: geo
            .as_ref()
            .and_then(|g| g.continent.as_deref())
            .map(Into::into),
        country: geo
            .as_ref()
            .and_then(|g| g.country.as_deref())
            .map(Into::into),
        country_code: geo
            .as_ref()
            .and_then(|g| g.country_code.as_deref())
            .map(Into::into),
        state_province: geo
            .as_ref()
            .and_then(|g| g.state_province.as_deref())
            .map(Into::into),
        county: geo
            .as_ref()
            .and_then(|g| g.county.as_deref())
            .map(Into::into),
        municipality: geo
            .as_ref()
            .and_then(|g| g.municipality.as_deref())
            .map(Into::into),
        locality: geo
            .as_ref()
            .and_then(|g| g.locality.as_deref())
            .map(Into::into),
        water_body: geo
            .as_ref()
            .and_then(|g| g.water_body.as_deref())
            .map(Into::into),
        maximum_depth_in_meters: None,
        maximum_elevation_in_meters: None,
        minimum_depth_in_meters: None,
        minimum_elevation_in_meters: None,
        extra_data: None,
    };

    // Build record in a block so CowStr borrows are released before variables are moved
    let record_value = {
        let recorded_by_cowstrs: Option<Vec<jacquard_common::CowStr<'_>>> = body
            .recorded_by
            .as_ref()
            .filter(|r| !r.is_empty())
            .map(|r| r.iter().map(|s| s.as_str().into()).collect());

        let record = Occurrence::new()
            .event_date(event_date)
            .location(location)
            .created_at(now)
            .maybe_notes(body.notes.as_deref().map(Into::into))
            .maybe_recorded_by(recorded_by_cowstrs)
            .build();

        let mut rv =
            serde_json::to_value(&record).map_err(|e| AppError::Internal(e.to_string()))?;
        rv["$type"] = json!(Occurrence::NSID);
        if !blobs.is_empty() {
            rv["blobs"] = json!(blobs);
        }
        rv
    };

    // Clone record_value before it's consumed by create_record
    let record_value_for_db = record_value.clone();

    // Create AT Protocol record
    let resp = agent
        .api
        .com
        .atproto
        .repo
        .create_record(
            atrium_api::com::atproto::repo::create_record::InputData {
                collection: Occurrence::NSID
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
                tracing::warn!(
                    error = %e,
                    "AT Protocol authentication failed (session expired)"
                );
                AppError::Unauthorized
            } else {
                AppError::Internal(format!("Failed to create record: {e}"))
            }
        })?;

    let uri = resp.uri.to_string();
    let cid = resp.cid.as_ref().to_string();

    info!(uri = %uri, "Created occurrence");

    // Immediate DB upsert for visibility — uses the same shared conversion
    // as the ingester so field mapping is always consistent.
    if let Ok(params) = observing_db::processing::occurrence_from_json(
        &record_value_for_db,
        uri.clone(),
        cid.clone(),
        user.did.clone(),
    ) {
        let _ = observing_db::occurrences::upsert(&state.pool, &params).await;
    }

    // Save private location data
    let _ =
        observing_db::private_data::save(&state.pool, &uri, body.latitude, body.longitude, "open")
            .await;

    // Sync observers
    let co_observers = body.recorded_by.unwrap_or_default();
    let _ = observing_db::observers::sync(&state.pool, &uri, &user.did, &co_observers).await;

    // Auto-create first identification if a scientific name was provided
    if let Some(ref scientific_name) = body.scientific_name {
        if !scientific_name.is_empty() {
            let id_value =
                auto_id::build_identification_record(&state, scientific_name, &uri, &cid).await?;

            let id_value_for_db = id_value.clone();

            match agent
                .api
                .com
                .atproto
                .repo
                .create_record(
                    atrium_api::com::atproto::repo::create_record::InputData {
                        collection: auto_id::identification_nsid()
                            .parse()
                            .map_err(|e| AppError::Internal(format!("Invalid NSID: {e}")))?,
                        record: serde_json::from_value(id_value).map_err(|e| {
                            AppError::Internal(format!("Failed to convert record: {e}"))
                        })?,
                        repo: atrium_api::types::string::AtIdentifier::Did(
                            atrium_api::types::string::Did::new(user.did.clone())
                                .map_err(|e| AppError::Internal(format!("Invalid DID: {e}")))?,
                        ),
                        rkey: None,
                        swap_commit: None,
                        validate: None,
                    }
                    .into(),
                )
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
                        let _ = observing_db::identifications::upsert(&state.pool, &params).await;
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "Failed to auto-create identification");
                }
            }
        }
    }

    Ok(Json(json!({
        "success": true,
        "uri": uri,
        "cid": cid,
    })))
}

/// POST catch-all for /api/occurrences/{*uri} -- dispatches observers POST
pub async fn post_occurrence_catch_all(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Path(full_path): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    if let Some(uri) = full_path.strip_suffix("/observers") {
        let user = auth::require_auth(&state.pool, &cookies)
            .await
            .map_err(|_| AppError::Unauthorized)?;
        let observer_did = body["did"]
            .as_str()
            .ok_or_else(|| AppError::BadRequest("did is required".into()))?;
        let _ = observing_db::observers::add(&state.pool, uri, &user.did, "owner").await;
        let _ = observing_db::observers::add(&state.pool, uri, observer_did, "co-observer").await;
        return Ok(Json(json!({ "success": true })));
    }

    Err(AppError::NotFound("Not found".into()))
}

/// DELETE catch-all for /api/occurrences/{*uri} -- dispatches occurrence delete or observer remove
pub async fn delete_occurrence_catch_all(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Path(full_path): Path<String>,
) -> Result<Json<Value>, AppError> {
    // Try observer removal: path contains /observers/{did}
    if full_path.contains("/observers/") {
        let idx = full_path.rfind("/observers/").unwrap();
        let uri = &full_path[..idx];
        let observer_did = &full_path[idx + "/observers/".len()..];
        let _user = auth::require_auth(&state.pool, &cookies)
            .await
            .map_err(|_| AppError::Unauthorized)?;
        let _ = observing_db::observers::remove(&state.pool, uri, observer_did).await;
        return Ok(Json(json!({ "success": true })));
    }

    // Otherwise, delete the occurrence itself
    let uri = &full_path;
    let user = auth::require_auth(&state.pool, &cookies)
        .await
        .map_err(|_| AppError::Unauthorized)?;

    let at_uri = AtUri::parse(uri).ok_or_else(|| AppError::BadRequest("Invalid AT URI".into()))?;

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

    let _ = observing_db::occurrences::delete(&state.pool, uri).await;

    Ok(Json(json!({ "success": true })))
}
