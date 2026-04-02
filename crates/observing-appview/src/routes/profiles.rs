use axum::extract::{Path, Query, State};
use axum::Json;
use observing_db::types::{ProfileFeedOptions, ProfileFeedType};
use serde::Deserialize;

use crate::auth::session_did;
use crate::constants;
use crate::enrichment::{self, ProfileSummary};
use crate::error::AppError;
use crate::responses::{ProfileCounts, ProfileFeedResponse};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ProfileFeedParams {
    limit: Option<i64>,
    cursor: Option<String>,
    #[serde(rename = "type")]
    feed_type: Option<String>,
}

pub async fn get_profile_feed(
    State(state): State<AppState>,
    cookies: axum_extra::extract::CookieJar,
    Path(did): Path<String>,
    Query(params): Query<ProfileFeedParams>,
) -> Result<Json<ProfileFeedResponse>, AppError> {
    let limit = params
        .limit
        .unwrap_or(constants::DEFAULT_FEED_LIMIT)
        .min(constants::MAX_FEED_LIMIT);

    let feed_type = match params.feed_type.as_deref() {
        Some("observations") => ProfileFeedType::Observations,
        Some("identifications") => ProfileFeedType::Identifications,
        _ => ProfileFeedType::All,
    };

    let options = ProfileFeedOptions {
        limit: Some(limit),
        cursor: params.cursor,
        feed_type: Some(feed_type),
    };

    let result = observing_db::feeds::get_profile_feed(&state.pool, &did, &options).await?;

    let viewer = session_did(&cookies);
    let occurrences = enrichment::enrich_occurrences(
        &state.pool,
        &state.resolver,
        &state.taxonomy,
        &result.occurrences,
        viewer.as_deref(),
    )
    .await;

    let identifications =
        enrichment::enrich_identifications(&state.resolver, &result.identifications).await;

    // Resolve profile for the DID
    let profile = state.resolver.get_profile(&did).await;

    let next_cursor = occurrences
        .last()
        .map(|o| o.created_at.clone())
        .or_else(|| {
            result
                .identifications
                .last()
                .map(|i| i.date_identified.to_string())
        });

    Ok(Json(ProfileFeedResponse {
        profile: ProfileSummary {
            did: did.clone(),
            handle: profile.as_ref().map(|p| p.handle.clone()),
            display_name: profile.as_ref().and_then(|p| p.display_name.clone()),
            avatar: profile.as_ref().and_then(|p| p.avatar.clone()),
        },
        counts: ProfileCounts {
            observations: result.counts.observations,
            identifications: result.counts.identifications,
            species: result.counts.species,
        },
        occurrences,
        identifications,
        cursor: next_cursor,
    }))
}
