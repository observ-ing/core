use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use tracing::{debug, error};

use crate::audio_id_client::IdentifyResponse;
use crate::auth::AuthUser;
use crate::state::AppState;
use crate::taxonomy_client::TaxonResult;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentifyRequest {
    /// Base64-encoded audio data (wav/mp3/flac/ogg).
    audio: String,
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

/// Enriched suggestion shape mirrors the species-id route so the frontend
/// can reuse the same rendering component for image and sound results.
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
    pub clip_duration_secs: f32,
}

/// POST /api/audio-id
///
/// Proxies to the audio identification service and enriches each suggestion
/// with a GBIF taxon match (same flow as `/api/species-id`).
pub async fn identify(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(body): Json<IdentifyRequest>,
) -> impl IntoResponse {
    let client = match &state.audio_id {
        Some(c) => c,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse {
                    error: "Audio identification service not configured".into(),
                }),
            )
                .into_response();
        }
    };

    match client
        .identify(&body.audio, body.latitude, body.longitude, body.limit)
        .await
    {
        Ok(response) => Json(enrich_suggestions(&state, response).await).into_response(),
        Err(e) => {
            error!(error = %e, "Audio identification failed");
            (
                StatusCode::BAD_GATEWAY,
                Json(ErrorResponse {
                    error: "Audio identification failed".into(),
                }),
            )
                .into_response()
        }
    }
}

/// Identical hydration flow to `routes::species_id::enrich_suggestions` —
/// kept inline rather than factored out until both routes are exercised in
/// production and the shared logic is known to remain stable.
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
                });

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
                    "Hydrated audio-id suggestion with GBIF match"
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
        clip_duration_secs: response.clip_duration_secs,
    }
}
