use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use tracing::debug;

use crate::auth::AuthUser;
use crate::species_id_client::IdentifyResponse;
use crate::state::AppState;

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
        Some(mut response) => {
            enrich_common_names(&state, &mut response).await;
            Json(response).into_response()
        }
        None => (
            StatusCode::BAD_GATEWAY,
            Json(ErrorResponse {
                error: "Species identification failed".into(),
            }),
        )
            .into_response(),
    }
}

/// Fill in missing common names by looking up each scientific name via the
/// taxonomy service. Failures are silently ignored — common names are
/// best-effort.
async fn enrich_common_names(state: &AppState, response: &mut IdentifyResponse) {
    let futures: Vec<_> = response
        .suggestions
        .iter()
        .enumerate()
        .filter(|(_, s)| s.common_name.is_none())
        .map(|(i, s)| {
            let taxonomy = state.taxonomy.clone();
            let name = s.scientific_name.clone();
            async move {
                let result = taxonomy.search(&name, Some(1)).await;
                let common_name = result
                    .and_then(|results| results.into_iter().next())
                    .and_then(|t| t.common_name);
                (i, common_name)
            }
        })
        .collect();

    for (i, common_name) in futures::future::join_all(futures).await {
        if let Some(name) = common_name {
            debug!(scientific_name = %response.suggestions[i].scientific_name, common_name = %name, "Enriched common name");
            response.suggestions[i].common_name = Some(name);
        }
    }
}
