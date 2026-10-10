use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, error};
use utoipa::{IntoParams, ToSchema};

use crate::auth::AuthUser;
use crate::error::ErrorResponse;
use crate::species_id_client::{IdentifyResponse, SpeciesIdClient, SpeciesIdStatus};
use crate::state::AppState;
use crate::taxonomy_client::TaxonResult;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyRequest {
    /// Base64-encoded image data
    image: String,
    /// Where the photo was taken. With `longitude`, lets the model flag
    /// suggestions that are out of range.
    #[serde(default)]
    latitude: Option<f64>,
    #[serde(default)]
    longitude: Option<f64>,
    /// Maximum number of suggestions to return.
    #[serde(default)]
    limit: Option<usize>,
    /// Route to the faster live-loop model (ViT-L). The continuous camera
    /// preview sets this; the upload/capture re-ID leaves it false so it gets
    /// the full-accuracy model. Falls back to the full model when no live
    /// service is configured.
    #[serde(default)]
    live: bool,
}

/// A single ranked AI suggestion enriched with the GBIF match (when the
/// scientific name resolves to a known taxon). The frontend treats a
/// suggestion with `taxonMatch` set the same as a user picking from the
/// autocomplete: the kingdom/rank fields disappear and the match indicator
/// shows "Existing taxon".
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = SpeciesSuggestion)]
pub struct EnrichedSpeciesSuggestion {
    pub scientific_name: String,
    pub confidence: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub common_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kingdom: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_range: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub taxon_match: Option<TaxonResult>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = IdentifyResponse)]
pub struct EnrichedIdentifyResponse {
    pub suggestions: Vec<EnrichedSpeciesSuggestion>,
    pub model_version: String,
    pub inference_time_ms: u64,
}

/// Identify the species in a photo.
///
/// Returns ranked suggestions from the species identification model, each
/// matched against GBIF where the name resolves. Requires authentication to
/// prevent abuse.
#[utoipa::path(
    post,
    path = "/api/species-id",
    operation_id = "identify_species",
    tag = "species-id",
    request_body = IdentifyRequest,
    security(("session" = [])),
    responses(
        (status = 200, description = "Ranked suggestions", body = EnrichedIdentifyResponse),
        (status = 401, description = "Not signed in", body = ErrorResponse),
        (status = 502, description = "The identification service failed", body = ErrorResponse),
        (status = 503, description = "No identification service is configured", body = ErrorResponse),
    )
)]
pub async fn identify(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(body): Json<IdentifyRequest>,
) -> impl IntoResponse {
    let Some(client) = select_client(&state, body.live) else {
        return not_configured();
    };

    match client
        .identify(&body.image, body.latitude, body.longitude, body.limit)
        .await
    {
        Ok(response) => Json(enrich_suggestions(&state, response).await).into_response(),
        Err(e) => {
            error!(error = %e, "Species identification failed");
            (
                StatusCode::BAD_GATEWAY,
                Json(ErrorResponse {
                    error: "Species identification failed".into(),
                }),
            )
                .into_response()
        }
    }
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct StatusQuery {
    /// Check the live-loop (ViT-L) service instead of the full model.
    #[serde(default)]
    live: bool,
}

/// Check whether species identification is warm.
///
/// Reports whether the species-id service has a warm instance and, if not,
/// roughly how long until an identify request would come back. The check
/// itself wakes a cold service, so the frontend calls this as soon as the
/// user starts a flow that will need an ID (e.g. opening the upload modal)
/// to get the boot underway while they pick a photo. Authenticated like
/// `identify` so anonymous traffic can't keep the service awake.
#[utoipa::path(
    get,
    path = "/api/species-id/status",
    operation_id = "get_species_id_status",
    tag = "species-id",
    params(StatusQuery),
    security(("session" = [])),
    responses(
        (status = 200, description = "Whether the service is warm, and if not, roughly how long it will take", body = SpeciesIdStatus),
        (status = 401, description = "Not signed in", body = ErrorResponse),
        (status = 503, description = "No identification service is configured", body = ErrorResponse),
    )
)]
pub async fn status(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(query): Query<StatusQuery>,
) -> impl IntoResponse {
    match select_client(&state, query.live) {
        Some(client) => Json(client.status().await).into_response(),
        None => not_configured(),
    }
}

/// Live requests prefer the faster ViT-L service, falling back to the full
/// model when no live service is configured (e.g. local dev). Non-live
/// requests (upload/capture re-ID) always use the full-accuracy model.
fn select_client(state: &AppState, live: bool) -> Option<&Arc<SpeciesIdClient>> {
    match (live, &state.species_id_live, &state.species_id) {
        (true, Some(live), _) => Some(live),
        (_, _, full) => full.as_ref(),
    }
}

fn not_configured() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ErrorResponse {
            error: "Species identification service not configured".into(),
        }),
    )
        .into_response()
}

/// Hydrate AI suggestions with GBIF match data, photo, and common name.
///
/// For each suggestion we run `validate` (decides whether the AI's name
/// resolves to a known taxon) and `get_by_name` in parallel. The validate
/// result's `taxon` field comes from the GBIF species-search shape, which
/// has sparse photoUrl/vernacular fields — so when validate matches, we
/// pull `photoUrl` and `commonName` off the `get_by_name` `TaxonDetail`
/// (which resolves to the canonical usage key, sources the photo from
/// Wikidata Commons P18, and merges in GBIF's vernacular-names endpoint).
///
/// Failures are silently ignored — all three fields are best-effort.
async fn enrich_suggestions(
    state: &AppState,
    response: IdentifyResponse,
) -> EnrichedIdentifyResponse {
    let futures = response.suggestions.iter().map(|s| {
        let taxonomy = state.taxonomy.clone();
        let name = s.scientific_name.clone();
        let kingdom = s.kingdom.clone();
        async move {
            let (validate_result, by_name_detail) =
                tokio::join!(taxonomy.validate(&name, kingdom.as_deref()), async {
                    taxonomy
                        .get_by_name(&name, kingdom.as_deref())
                        .await
                        .ok()
                        .flatten()
                },);

            let taxon_match = validate_result
                .filter(|v| v.valid)
                .and_then(|v| v.taxon)
                .map(|mut t| {
                    if let Some(ref detail) = by_name_detail {
                        if t.photo_url.is_none() {
                            t.photo_url = detail.photo_url.clone();
                        }
                        if t.common_name.is_none() {
                            t.common_name = detail.common_name.clone();
                        }
                    }
                    t
                });
            let extra_common_name = by_name_detail.and_then(|t| t.common_name);
            (taxon_match, extra_common_name)
        }
    });

    let results: Vec<_> = futures::future::join_all(futures).await;

    let suggestions = response
        .suggestions
        .into_iter()
        .zip(results)
        .map(|(s, (taxon_match, extra_common_name))| {
            let common_name = s.common_name.or(extra_common_name);
            if let Some(ref m) = taxon_match {
                debug!(
                    scientific_name = %s.scientific_name,
                    matched_id = %m.id,
                    matched_rank = %m.rank,
                    "Hydrated AI suggestion with GBIF match"
                );
            }
            EnrichedSpeciesSuggestion {
                scientific_name: s.scientific_name,
                confidence: s.confidence,
                common_name,
                kingdom: s.kingdom,
                in_range: s.in_range,
                taxon_match,
            }
        })
        .collect();

    EnrichedIdentifyResponse {
        suggestions,
        model_version: response.model_version,
        inference_time_ms: response.inference_time_ms,
    }
}
