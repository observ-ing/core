use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use tracing::{debug, error};

use crate::auth::AuthUser;
use crate::species_id_client::IdentifyResponse;
use crate::state::AppState;
use crate::taxonomy_client::TaxonResult;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyRequest {
    /// Base64-encoded image data
    image: String,
    #[serde(default)]
    latitude: Option<f64>,
    #[serde(default)]
    longitude: Option<f64>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    error: String,
}

/// A single ranked AI suggestion enriched with the GBIF match (when the
/// scientific name resolves to a known taxon). The frontend treats a
/// suggestion with `taxonMatch` set the same as a user picking from the
/// autocomplete: the kingdom/rank fields disappear and the match indicator
/// shows "Existing taxon".
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrichedIdentifyResponse {
    pub suggestions: Vec<EnrichedSpeciesSuggestion>,
    pub model_version: String,
    pub inference_time_ms: u64,
}

/// POST /api/species-id
///
/// Proxies to the species identification service.
/// Requires authentication to prevent abuse.
pub async fn identify(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(body): Json<IdentifyRequest>,
) -> impl IntoResponse {
    let client = match &state.species_id {
        Some(c) => c,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse {
                    error: "Species identification service not configured".into(),
                }),
            )
                .into_response();
        }
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
