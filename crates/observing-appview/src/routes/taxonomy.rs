use axum::extract::{Path, Query, State};
use axum::Json;
use observing_db::types::TaxonOccurrenceOptions;
use serde::Deserialize;

use crate::auth::session_did;
use crate::constants;
use crate::enrichment;
use crate::error::AppError;
use crate::responses::{OccurrenceListResponse, TaxonSearchResponse};
use crate::state::AppState;
use crate::taxonomy_client::{TaxonDetailWithCount, ValidateResponse};

#[derive(Deserialize)]
pub struct SearchParams {
    q: Option<String>,
}

pub async fn search(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<TaxonSearchResponse>, AppError> {
    let query = params
        .q
        .ok_or_else(|| AppError::BadRequest("q is required".into()))?;

    if query.len() < constants::MIN_SEARCH_QUERY_LENGTH {
        return Err(AppError::BadRequest(format!(
            "Search query must be at least {} characters",
            constants::MIN_SEARCH_QUERY_LENGTH
        )));
    }

    // Run traditional search and AI search in parallel
    let trad_fut = state.taxonomy.search(&query, None);
    let ai_fut = async {
        if let Some(client) = &state.species_id {
            client.search(&query, Some(10)).await
        } else {
            None
        }
    };

    let (trad_results, ai_suggestions) = tokio::join!(trad_fut, ai_fut);
    let mut results = trad_results.unwrap_or_default();
    let ai_suggestions = ai_suggestions.unwrap_or_default();

    // Deduplicate and merge:
    // 1. Keep all traditional results (they are "authoritative")
    // 2. Add AI results that aren't already in the list
    for ai in ai_suggestions {
        if !results
            .iter()
            .any(|r| r.scientific_name == ai.scientific_name)
        {
            results.push(crate::taxonomy_client::TaxonResult {
                id: format!("ai:{}", ai.scientific_name),
                scientific_name: ai.scientific_name,
                common_name: ai.common_name,
                photo_url: None,             // AI service doesn't return photos yet
                rank: "species".to_string(), // PoC assumes species rank for now
                kingdom: ai.kingdom,
                phylum: ai.phylum,
                class: ai.class,
                order: ai.order,
                family: ai.family,
                genus: ai.genus,
                species: None,
                source: "ai".to_string(),
                conservation_status: None,
                confidence: Some(ai.confidence),
            });
        }
    }

    // Re-rank: perfect matches on query string first, then maintain order
    let query_lower = query.to_lowercase();
    results.sort_by(|a, b| {
        let a_exact = a.scientific_name.to_lowercase() == query_lower
            || a.common_name
                .as_ref()
                .map(|cn| cn.to_lowercase() == query_lower)
                .unwrap_or(false);
        let b_exact = b.scientific_name.to_lowercase() == query_lower
            || b.common_name
                .as_ref()
                .map(|cn| cn.to_lowercase() == query_lower)
                .unwrap_or(false);

        match (a_exact, b_exact) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => std::cmp::Ordering::Equal, // Maintain relative order from sources
        }
    });

    Ok(Json(TaxonSearchResponse { results }))
}

#[derive(Deserialize)]
pub struct ValidateParams {
    name: Option<String>,
}

pub async fn validate(
    State(state): State<AppState>,
    Query(params): Query<ValidateParams>,
) -> Result<Json<ValidateResponse>, AppError> {
    let name = params
        .name
        .ok_or_else(|| AppError::BadRequest("name is required".into()))?;

    match state.taxonomy.validate(&name).await {
        Some(result) => Ok(Json(result)),
        None => Ok(Json(ValidateResponse {
            valid: false,
            matched_name: None,
            taxon: None,
            suggestions: Some(vec![]),
        })),
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
) -> Result<Json<TaxonDetailWithCount>, AppError> {
    // Frontend uses dashes in URLs (e.g., "Morus-alba"), convert to spaces
    let name = name.replace('-', " ");

    let detail = state
        .taxonomy
        .get_by_name(&name, Some(&kingdom))
        .await
        .ok_or_else(|| AppError::NotFound("Taxon not found".into()))?;

    let count = observing_db::feeds::count_occurrences_by_taxon(
        &state.pool,
        &name,
        &detail.rank,
        Some(&kingdom),
    )
    .await
    .unwrap_or(0);

    Ok(Json(TaxonDetailWithCount {
        detail,
        observation_count: count,
    }))
}

pub async fn get_taxon_occurrences_by_kingdom_name(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Path((kingdom, name)): Path<(String, String)>,
    Query(params): Query<TaxonOccurrenceParams>,
) -> Result<Json<OccurrenceListResponse>, AppError> {
    let limit = params
        .limit
        .unwrap_or(constants::DEFAULT_FEED_LIMIT)
        .min(constants::MAX_FEED_LIMIT);
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

    Ok(Json(OccurrenceListResponse {
        occurrences,
        cursor: next_cursor,
    }))
}

pub async fn get_taxon_by_id(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TaxonDetailWithCount>, AppError> {
    let detail = state
        .taxonomy
        .get_by_id(&id)
        .await
        .ok_or_else(|| AppError::NotFound("Taxon not found".into()))?;

    let count = observing_db::feeds::count_occurrences_by_taxon(
        &state.pool,
        &detail.scientific_name,
        &detail.rank,
        detail.kingdom.as_deref(),
    )
    .await
    .unwrap_or(0);

    Ok(Json(TaxonDetailWithCount {
        detail,
        observation_count: count,
    }))
}

pub async fn get_taxon_occurrences_by_id(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Path(id): Path<String>,
    Query(params): Query<TaxonOccurrenceParams>,
) -> Result<Json<OccurrenceListResponse>, AppError> {
    let limit = params
        .limit
        .unwrap_or(constants::DEFAULT_FEED_LIMIT)
        .min(constants::MAX_FEED_LIMIT);

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

    Ok(Json(OccurrenceListResponse {
        occurrences,
        cursor: next_cursor,
    }))
}
