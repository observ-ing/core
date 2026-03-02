use axum::extract::{Path, Query, State};
use axum::Json;
use observing_db::types::TaxonOccurrenceOptions;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::session_did;
use crate::enrichment;
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

    if query.len() < 2 {
        return Err(AppError::BadRequest(
            "Search query must be at least 2 characters".into(),
        ));
    }

    let results = state
        .taxonomy
        .search(&query, None)
        .await
        .unwrap_or_default();

    Ok(Json(json!({ "results": results })))
}

#[derive(Deserialize)]
pub struct ValidateParams {
    name: Option<String>,
}

pub async fn validate(
    State(state): State<AppState>,
    Query(params): Query<ValidateParams>,
) -> Result<Json<Value>, AppError> {
    let name = params
        .name
        .ok_or_else(|| AppError::BadRequest("name is required".into()))?;

    match state.taxonomy.validate(&name).await {
        Some(result) => Ok(Json(json!(result))),
        None => Ok(Json(json!({
            "valid": false,
            "suggestions": [],
        }))),
    }
}

#[derive(Deserialize)]
pub struct TaxonOccurrenceParams {
    limit: Option<i64>,
    cursor: Option<String>,
}

pub async fn get_taxon_by_kingdom_name(
    State(state): State<AppState>,
    Path((kingdom, name)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    // Frontend uses dashes in URLs (e.g., "Morus-alba"), convert to spaces
    let name = name.replace('-', " ");

    let mut detail = state
        .taxonomy
        .get_by_name_raw(&name, Some(&kingdom))
        .await
        .ok_or_else(|| AppError::NotFound("Taxon not found".into()))?;

    let rank = detail["rank"].as_str().unwrap_or("species").to_string();
    let count =
        observing_db::feeds::count_occurrences_by_taxon(&state.pool, &name, &rank, Some(&kingdom))
            .await
            .unwrap_or(0);

    // TS returns {...taxon, observationCount} (taxon fields at root level)
    if let Value::Object(ref mut map) = detail {
        map.insert("observationCount".to_string(), json!(count));
    }

    Ok(Json(detail))
}

pub async fn get_taxon_occurrences_by_kingdom_name(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Path((kingdom, name)): Path<(String, String)>,
    Query(params): Query<TaxonOccurrenceParams>,
) -> Result<Json<Value>, AppError> {
    let limit = params.limit.unwrap_or(20).min(100);
    let name = name.replace('-', " ");

    // Look up taxon to get rank
    let detail = state.taxonomy.get_by_name(&name, Some(&kingdom)).await;
    let rank = detail
        .as_ref()
        .map(|d| d.rank.clone())
        .unwrap_or_else(|| "species".to_string());

    let options = TaxonOccurrenceOptions {
        limit: Some(limit),
        cursor: params.cursor,
        kingdom: Some(kingdom),
    };

    let rows = observing_db::feeds::get_occurrences_by_taxon(
        &state.pool,
        &name,
        &rank,
        &options,
        &state.hidden_dids,
    )
    .await?;

    let viewer = session_did(&cookies);
    let occurrences = enrichment::enrich_occurrences(
        &state.pool,
        &state.resolver,
        &state.taxonomy,
        &rows,
        viewer.as_deref(),
    )
    .await;

    let next_cursor = occurrences.last().map(|o| o.created_at.clone());

    Ok(Json(json!({
        "occurrences": occurrences,
        "cursor": next_cursor,
    })))
}

pub async fn get_taxon_by_id(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let mut detail = state
        .taxonomy
        .get_by_id_raw(&id)
        .await
        .ok_or_else(|| AppError::NotFound("Taxon not found".into()))?;

    let rank = detail["rank"].as_str().unwrap_or("species").to_string();
    let scientific_name = detail["scientificName"].as_str().unwrap_or(&id).to_string();
    let kingdom = detail["kingdom"].as_str().map(|s| s.to_string());
    let count = observing_db::feeds::count_occurrences_by_taxon(
        &state.pool,
        &scientific_name,
        &rank,
        kingdom.as_deref(),
    )
    .await
    .unwrap_or(0);

    // TS returns {...taxon, observationCount} (taxon fields at root level)
    if let Value::Object(ref mut map) = detail {
        map.insert("observationCount".to_string(), json!(count));
    }

    Ok(Json(detail))
}

pub async fn get_taxon_occurrences_by_id(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Path(id): Path<String>,
    Query(params): Query<TaxonOccurrenceParams>,
) -> Result<Json<Value>, AppError> {
    let limit = params.limit.unwrap_or(20).min(100);

    // Look up taxon to get name + rank
    let detail = state.taxonomy.get_by_id(&id).await;

    let (name, rank, kingdom) = match detail {
        Some(ref d) => (d.scientific_name.clone(), d.rank.clone(), d.kingdom.clone()),
        None => (id.clone(), "species".to_string(), None),
    };

    let options = TaxonOccurrenceOptions {
        limit: Some(limit),
        cursor: params.cursor,
        kingdom,
    };

    let rows = observing_db::feeds::get_occurrences_by_taxon(
        &state.pool,
        &name,
        &rank,
        &options,
        &state.hidden_dids,
    )
    .await?;

    let viewer = session_did(&cookies);
    let occurrences = enrichment::enrich_occurrences(
        &state.pool,
        &state.resolver,
        &state.taxonomy,
        &rows,
        viewer.as_deref(),
    )
    .await;

    let next_cursor = occurrences.last().map(|o| o.created_at.clone());

    Ok(Json(json!({
        "occurrences": occurrences,
        "cursor": next_cursor,
    })))
}
