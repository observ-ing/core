use axum::extract::{Path, State};
use axum::Json;
use serde_json::{json, Value};

use crate::enrichment;
use crate::error::AppError;
use crate::state::AppState;

pub async fn get_for_occurrence(
    State(state): State<AppState>,
    Path(occurrence_uri): Path<String>,
) -> Result<Json<Value>, AppError> {
    let rows =
        observing_db::identifications::get_for_occurrence(&state.pool, &occurrence_uri).await?;

    let identifications = enrichment::enrich_identifications(&state.resolver, &rows).await;

    let community_id =
        observing_db::identifications::get_community_id(&state.pool, &occurrence_uri, 0).await?;

    Ok(Json(json!({
        "identifications": identifications,
        "communityId": community_id,
    })))
}
