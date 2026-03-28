use axum::extract::{Path, State};
use axum::Json;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::Datetime;
use observing_db::types::InteractionDirection;
use observing_lexicons::org_rwell::test::identification::Taxon;
use observing_lexicons::org_rwell::test::interaction::{Interaction, InteractionSubject};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;
use ts_rs::TS;

use crate::auth::{self, AuthUser};
use crate::constants;
use crate::enrichment;
use crate::error::AppError;
use crate::responses::RecordCreatedResponse;
use crate::state::AppState;
use crate::validation::validate_string_length;

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
    #[ts(optional)]
    comment: Option<String>,
}

fn build_interaction_subject(
    req: &InteractionSubjectRequest,
) -> Result<InteractionSubject<'_>, AppError> {
    let occurrence = match (&req.occurrence_uri, &req.occurrence_cid) {
        (Some(uri), Some(cid)) => Some(auth::build_strong_ref(uri, cid)?),
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
    user: AuthUser,
    Json(body): Json<CreateInteractionRequest>,
) -> Result<Json<RecordCreatedResponse>, AppError> {
    validate_string_length(
        &body.interaction_type,
        1,
        constants::MAX_INTERACTION_TYPE_LENGTH,
        "Interaction type",
    )?;

    let direction = body
        .direction
        .as_deref()
        .unwrap_or(constants::DEFAULT_INTERACTION_DIRECTION);

    let subject_a = build_interaction_subject(&body.subject_a)?;
    let subject_b = build_interaction_subject(&body.subject_b)?;

    let record = Interaction::new()
        .subject_a(subject_a)
        .subject_b(subject_b)
        .interaction_type(&*body.interaction_type)
        .direction(direction)
        .created_at(Datetime::now())
        .maybe_comment(body.comment.as_deref().map(Into::into))
        .build();

    let record_value = auth::serialize_at_record(&record)?;

    let (agent, did_parsed) = auth::require_agent(&state.oauth_client, &user.did).await?;
    let resp = auth::create_at_record(&agent, did_parsed, Interaction::NSID, record_value).await?;

    info!(uri = %resp.uri, "Created interaction");

    Ok(Json(RecordCreatedResponse {
        success: true,
        uri: resp.uri.to_string(),
        cid: resp.cid.as_ref().to_string(),
    }))
}
