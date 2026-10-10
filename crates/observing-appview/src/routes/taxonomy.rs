use axum::extract::{Path, Query, State};
use axum::Json;
use observing_db::types::TaxonOccurrenceOptions;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::auth::session_did;
use crate::constants;
use crate::enrichment;
use crate::error::{AppError, ErrorResponse};
use crate::responses::{OccurrenceListResponse, TaxonSearchResponse};
use crate::state::AppState;
use crate::taxonomy_client::{
    TaxonDetail, TaxonDetailWithCount, TaxonResult, TaxonomyClientError, ValidateResponse,
};

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SearchParams {
    /// Search text, at least 2 characters.
    #[param(required = true, value_type = String)]
    q: Option<String>,
}

/// Search taxa by name.
///
/// Full-text search of the GBIF backbone taxonomy, for autocomplete. Returns
/// up to 10 matches.
#[utoipa::path(
    get,
    path = "/api/taxa/search",
    operation_id = "search_taxa",
    tag = "taxonomy",
    params(SearchParams),
    responses(
        (status = 200, description = "Matching taxa", body = TaxonSearchResponse),
        (status = 400, description = "`q` missing or too short", body = ErrorResponse),
    )
)]
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

    let results = state
        .taxonomy
        .search(&query, None)
        .await
        .unwrap_or_default();

    Ok(Json(TaxonSearchResponse { results }))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ValidateParams {
    /// Scientific name to check.
    #[param(required = true, value_type = String)]
    name: Option<String>,
    /// Kingdom hint, to disambiguate names used in more than one kingdom.
    kingdom: Option<String>,
}

/// Check a scientific name against GBIF.
#[utoipa::path(
    get,
    path = "/api/taxa/validate",
    operation_id = "validate_taxon",
    tag = "taxonomy",
    params(ValidateParams),
    responses(
        (status = 200, description = "Whether the name matched, with the match or close suggestions", body = ValidateResponse),
        (status = 400, description = "`name` missing", body = ErrorResponse),
    )
)]
pub async fn validate(
    State(state): State<AppState>,
    Query(params): Query<ValidateParams>,
) -> Result<Json<ValidateResponse>, AppError> {
    let name = params
        .name
        .ok_or_else(|| AppError::BadRequest("name is required".into()))?;

    match state
        .taxonomy
        .validate(&name, params.kingdom.as_deref())
        .await
    {
        Some(result) => Ok(Json(result)),
        None => Ok(Json(ValidateResponse {
            valid: false,
            matched_name: None,
            taxon: None,
            suggestions: Some(vec![]),
        })),
    }
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct TaxonOccurrenceParams {
    /// Page size. Values above 100 are clamped.
    #[param(default = json!(constants::DEFAULT_FEED_LIMIT))]
    limit: Option<i64>,
    /// `cursor` from the previous page.
    cursor: Option<String>,
}

/// Get a taxon by kingdom and name.
#[utoipa::path(
    get,
    path = "/api/taxa/{kingdom}/{name}",
    tag = "taxonomy",
    params(("kingdom" = String, Path, description = "Kingdom name, e.g. `Plantae`"), ("name" = String, Path, description = "Scientific name, with spaces written as dashes (e.g. `Morus-alba`)")),
    responses(
        (status = 200, description = "The taxon, with how many occurrences it has", body = TaxonDetailWithCount),
        (status = 404, description = "No such taxon", body = ErrorResponse),
    )
)]
pub async fn get_taxon_by_kingdom_name(
    State(state): State<AppState>,
    Path((kingdom, name)): Path<(String, String)>,
) -> Result<Json<TaxonDetailWithCount>, AppError> {
    // Frontend uses dashes in URLs (e.g., "Morus-alba"), convert to spaces
    let name = name.replace('-', " ");

    let detail = state
        .taxonomy
        .get_by_name(&name, Some(&kingdom))
        .await?
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

/// List a taxon's child taxa.
#[utoipa::path(
    get,
    path = "/api/taxa/{kingdom}/{name}/children",
    tag = "taxonomy",
    params(("kingdom" = String, Path, description = "Kingdom name, e.g. `Plantae`"), ("name" = String, Path, description = "Scientific name, with spaces written as dashes (e.g. `Morus-alba`)")),
    responses(
        (status = 200, description = "Up to 20 children; empty if none were found", body = Vec<TaxonResult>),
    )
)]
pub async fn get_children_by_kingdom_name(
    State(state): State<AppState>,
    Path((kingdom, name)): Path<(String, String)>,
) -> Result<Json<Vec<TaxonResult>>, AppError> {
    let name = name.replace('-', " ");
    let children = state
        .taxonomy
        .get_children(&name, Some(&kingdom))
        .await
        .unwrap_or(None)
        .unwrap_or_default();
    Ok(Json(children))
}

/// List occurrences of a taxon, by kingdom and name.
///
/// Matches on the community identification, so includes occurrences of
/// descendant taxa.
#[utoipa::path(
    get,
    path = "/api/taxa/{kingdom}/{name}/occurrences",
    tag = "taxonomy",
    params(("kingdom" = String, Path, description = "Kingdom name, e.g. `Plantae`"), ("name" = String, Path, description = "Scientific name, with spaces written as dashes (e.g. `Morus-alba`)"), TaxonOccurrenceParams),
    security((), ("session" = [])),
    responses(
        (status = 200, description = "A page of occurrences", body = OccurrenceListResponse),
    )
)]
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
    let detail = state
        .taxonomy
        .get_by_name(&name, Some(&kingdom))
        .await
        .unwrap_or(None);
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

    let next_cursor = occurrences.last().map(|o| o.feed_cursor());

    Ok(Json(OccurrenceListResponse {
        occurrences,
        cursor: next_cursor,
    }))
}

/// Resolve `/api/taxa/{id}`-style input to a TaxonDetail. Accepts either a
/// GBIF id (`gbif:NNN` / bare numeric) or a scientific name (e.g. a kingdom
/// name like `Animalia`).
async fn resolve_taxon_by_id_or_name(
    state: &AppState,
    id: &str,
) -> Result<Option<TaxonDetail>, TaxonomyClientError> {
    if let Some(detail) = state.taxonomy.get_by_id(id).await? {
        return Ok(Some(detail));
    }
    if id.starts_with("gbif:") || id.parse::<u64>().is_ok() {
        return Ok(None);
    }
    state.taxonomy.get_by_name(id, None).await
}

/// Get a taxon by id.
#[utoipa::path(
    get,
    path = "/api/taxa/{id}",
    tag = "taxonomy",
    params(("id" = String, Path, description = "GBIF taxon id (`gbif:2878688` or `2878688`), or a scientific name")),
    responses(
        (status = 200, description = "The taxon, with how many occurrences it has", body = TaxonDetailWithCount),
        (status = 404, description = "No such taxon", body = ErrorResponse),
    )
)]
pub async fn get_taxon_by_id(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TaxonDetailWithCount>, AppError> {
    let detail = resolve_taxon_by_id_or_name(&state, &id)
        .await?
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

/// List occurrences of a taxon, by id.
///
/// Matches on the community identification, so includes occurrences of
/// descendant taxa.
#[utoipa::path(
    get,
    path = "/api/taxa/{id}/occurrences",
    tag = "taxonomy",
    params(("id" = String, Path, description = "GBIF taxon id (`gbif:2878688` or `2878688`), or a scientific name"), TaxonOccurrenceParams),
    security((), ("session" = [])),
    responses(
        (status = 200, description = "A page of occurrences", body = OccurrenceListResponse),
    )
)]
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
    let detail = resolve_taxon_by_id_or_name(&state, &id)
        .await
        .unwrap_or(None);

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

    let next_cursor = occurrences.last().map(|o| o.feed_cursor());

    Ok(Json(OccurrenceListResponse {
        occurrences,
        cursor: next_cursor,
    }))
}
