use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;

use crate::constants;
use crate::error::AppError;
use crate::responses::{ActorResponse, ActorSearchResponse};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct SearchParams {
    q: Option<String>,
}

pub async fn search(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<ActorSearchResponse>, AppError> {
    let query = params
        .q
        .ok_or_else(|| AppError::BadRequest("q is required".into()))?;

    if query.len() < constants::MIN_SEARCH_QUERY_LENGTH {
        return Err(AppError::BadRequest(format!(
            "Search query must be at least {} characters",
            constants::MIN_SEARCH_QUERY_LENGTH
        )));
    }

    let results = state
        .resolver
        .search_actors(&query, constants::ACTOR_SEARCH_LIMIT)
        .await;

    let actors: Vec<ActorResponse> = results
        .iter()
        .map(|p| ActorResponse {
            did: p.did.clone(),
            handle: p.handle.clone(),
            display_name: p.display_name.clone(),
            avatar: p.avatar.clone(),
        })
        .collect();

    Ok(Json(ActorSearchResponse { actors }))
}
