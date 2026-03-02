use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::constants;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct SearchParams {
    q: Option<String>,
}

pub async fn search(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<Value>, AppError> {
    let query = params
        .q
        .ok_or_else(|| AppError::BadRequest("q is required".into()))?;

    if query.len() < constants::MIN_SEARCH_QUERY_LENGTH {
        return Err(AppError::BadRequest(
            format!(
                "Search query must be at least {} characters",
                constants::MIN_SEARCH_QUERY_LENGTH
            )
            .into(),
        ));
    }

    let results = state
        .resolver
        .search_actors(&query, constants::ACTOR_SEARCH_LIMIT)
        .await;

    let actors: Vec<Value> = results
        .iter()
        .map(|p| {
            json!({
                "did": p.did,
                "handle": p.handle,
                "displayName": p.display_name,
                "avatar": p.avatar,
            })
        })
        .collect();

    Ok(Json(json!({ "actors": actors })))
}
