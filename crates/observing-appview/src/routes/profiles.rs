use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;

use crate::auth::session_did;
use crate::constants;
use crate::enrichment::{self, ProfileSummary};
use crate::error::AppError;
use crate::quickslice_convert;
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

    let feed_type = params.feed_type.as_deref();
    let wants_observations = feed_type != Some("identifications");
    let wants_identifications = feed_type != Some("observations");

    // Fetch occurrences and identifications from QuickSlice concurrently
    let (occ_result, id_result, occ_count, id_count) = tokio::join!(
        async {
            if wants_observations {
                state
                    .quickslice
                    .get_user_occurrences(&did, limit as i32, params.cursor.as_deref())
                    .await
                    .ok()
            } else {
                None
            }
        },
        async {
            if wants_identifications {
                state
                    .quickslice
                    .get_user_identifications(&did, limit as i32, params.cursor.as_deref())
                    .await
                    .ok()
            } else {
                None
            }
        },
        state.quickslice.count_user_occurrences(&did),
        state.quickslice.count_user_identifications(&did),
    );

    let occ_rows: Vec<_> = occ_result
        .map(|c| {
            c.nodes()
                .into_iter()
                .map(quickslice_convert::occurrence_from_qs)
                .collect()
        })
        .unwrap_or_default();

    let id_rows: Vec<_> = id_result
        .map(|c| {
            c.nodes()
                .into_iter()
                .map(quickslice_convert::identification_from_qs)
                .collect()
        })
        .unwrap_or_default();

    let viewer = session_did(&cookies);
    let occurrences = enrichment::enrich_occurrences(
        &state.pool,
        &state.resolver,
        &state.taxonomy,
        &occ_rows,
        viewer.as_deref(),
    )
    .await;

    let identifications = enrichment::enrich_identifications(&state.resolver, &id_rows).await;

    // Resolve profile for the DID
    let profile = state.resolver.get_profile(&did).await;

    let next_cursor = occurrences
        .last()
        .map(|o| o.created_at.clone())
        .or_else(|| id_rows.last().map(|i| i.date_identified.to_string()));

    Ok(Json(ProfileFeedResponse {
        profile: ProfileSummary {
            did: did.clone(),
            handle: profile.as_ref().map(|p| p.handle.clone()),
            display_name: profile.as_ref().and_then(|p| p.display_name.clone()),
            avatar: profile.as_ref().and_then(|p| p.avatar.clone()),
        },
        counts: ProfileCounts {
            observations: occ_count.unwrap_or(0),
            identifications: id_count.unwrap_or(0),
            species: 0, // TODO: species count not yet available via QuickSlice
        },
        occurrences,
        identifications,
        cursor: next_cursor,
    }))
}
