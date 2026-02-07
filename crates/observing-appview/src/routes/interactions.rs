use axum::extract::{Path, State};
use axum::Json;
use serde_json::{json, Value};

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
