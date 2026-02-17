use std::str::FromStr;

use axum::extract::{Path, State};
use axum::Json;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::{AtUri as JAtUri, Cid as JCid, Datetime};
use observing_db::types::{Confidence, InteractionDirection};
use observing_lexicons::com_atproto::repo::strong_ref::StrongRef;
use observing_lexicons::org_rwell::test::identification::Taxon;
use observing_lexicons::org_rwell::test::interaction::{Interaction, InteractionSubject};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;
use ts_rs::TS;

use crate::auth;
use crate::enrichment;
use crate::error::AppError;
use crate::state::AppState;

pub async fn get_for_occurrence(
    State(state): State<AppState>,
    Path(uri): Path<String>,
) -> Result<Json<Value>, AppError> {
    let rows = observing_db::interactions::get_for_occurrence(&state.pool, &uri).await?;

    let interactions = enrichment::enrich_interactions(&state.resolver, &rows).await;

    Ok(Json(json!({ "interactions": interactions })))
}

// --- Write handlers ---

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct InteractionSubjectRequest {
    #[ts(optional)]
    occurrence_uri: Option<String>,
    #[ts(optional)]
    occurrence_cid: Option<String>,
    #[ts(optional)]
    subject_index: Option<i32>,
    #[ts(optional)]
    scientific_name: Option<String>,
    #[ts(optional)]
    kingdom: Option<String>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct CreateInteractionRequest {
    subject_a: InteractionSubjectRequest,
    subject_b: InteractionSubjectRequest,
    interaction_type: String,
    #[ts(optional, as = "Option<InteractionDirection>")]
    direction: Option<String>,
    #[ts(optional, as = "Option<Confidence>")]
    confidence: Option<String>,
    #[ts(optional)]
    comment: Option<String>,
}

fn build_interaction_subject(
    req: &InteractionSubjectRequest,
) -> Result<InteractionSubject<'_>, AppError> {
    let occurrence = match (&req.occurrence_uri, &req.occurrence_cid) {
        (Some(uri), Some(cid)) => Some(
            StrongRef::new()
                .uri(
                    JAtUri::from_str(uri)
                        .map_err(|_| AppError::BadRequest("Invalid occurrence URI".into()))?,
                )
                .cid(
                    JCid::from_str(cid)
                        .map_err(|_| AppError::BadRequest("Invalid occurrence CID".into()))?,
                )
                .build(),
        ),
        _ => None,
    };

    let taxon = req.scientific_name.as_deref().map(|name| Taxon {
        scientific_name: name.into(),
        kingdom: req.kingdom.as_deref().map(Into::into),
        ..Default::default()
    });

    Ok(InteractionSubject {
        occurrence,
        subject_index: req.subject_index.map(|i| i as i64),
        taxon,
        extra_data: None,
    })
}

pub async fn create_interaction(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Json(body): Json<CreateInteractionRequest>,
) -> Result<Json<Value>, AppError> {
    let user = auth::require_auth(&state.pool, &cookies)
        .await
        .map_err(|_| AppError::Unauthorized)?;

    if body.interaction_type.is_empty() || body.interaction_type.len() > 64 {
        return Err(AppError::BadRequest(
            "Interaction type must be 1-64 characters".into(),
        ));
    }

    let direction = body.direction.as_deref().unwrap_or("AtoB");

    let subject_a = build_interaction_subject(&body.subject_a)?;
    let subject_b = build_interaction_subject(&body.subject_b)?;

    let record = Interaction::new()
        .subject_a(subject_a)
        .subject_b(subject_b)
        .interaction_type(&body.interaction_type)
        .direction(direction)
        .created_at(Datetime::now())
        .maybe_confidence(body.confidence.as_deref().map(Into::into))
        .maybe_comment(body.comment.as_deref().map(Into::into))
        .build();

    let mut record_value =
        serde_json::to_value(&record).map_err(|e| AppError::Internal(e.to_string()))?;
    record_value["$type"] = json!(Interaction::NSID);

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
                collection: Interaction::NSID
                    .parse()
                    .map_err(|e| AppError::Internal(format!("Invalid NSID: {e}")))?,
                record: serde_json::from_value(record_value)
                    .map_err(|e| {
                        AppError::Internal(format!("Failed to convert record: {e}"))
                    })?,
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

    info!(uri = %resp.uri, "Created interaction");

    Ok(Json(json!({
        "success": true,
        "uri": resp.uri,
        "cid": resp.cid.as_ref(),
    })))
}
