//! Background task: post an AI-authored identification under the bot's DID
//! after an occurrence is created.
//!
//! Spawned from `create_occurrence` so the user's submission is never blocked
//! on model inference or bot login. All failures are logged and dropped; the
//! observation itself is already on-PDS by the time we run.

use std::sync::Arc;

use observing_species_id_protocol::SpeciesSuggestion;
use tracing::{info, warn};

use crate::ai_agent::AiAgent;
use crate::routes::occurrences::auto_id;
use crate::state::AppState;

/// Identifier we stamp into the record. Stays consistent across model
/// versions so frontends can filter by "AI" without a version list.
const MODEL_NAME: &str = "BioCLIP";

/// Short delay before the AI bot publishes its identification, to give the
/// ingester a head start on the user's occurrence commit. The AI's commit
/// lands on a *different* Jetstream stream from the user's, so there is no
/// inherent ordering between them; if the identification arrives before the
/// occurrence row exists, the FK on `identifications.subject_uri` rejects
/// the upsert and the ingester drops the record (see
/// `crates/observing-ingester/src/main.rs` ~line 215, which logs and moves
/// on). Posting after a brief sleep makes the common case correct; the
/// proper fix is an FK-violation retry queue in the ingester.
const POST_DELAY: std::time::Duration = std::time::Duration::from_secs(2);

/// Run the species-id model against the occurrence's first image and post a
/// single AI-authored identification under the bot's DID when the top
/// suggestion clears the configured confidence threshold.
pub async fn post_ai_identification(
    state: AppState,
    ai_agent: Arc<AiAgent>,
    occurrence_uri: String,
    occurrence_cid: String,
    image_base64: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
) {
    tokio::time::sleep(POST_DELAY).await;

    let species_id = match &state.species_id {
        Some(c) => c.clone(),
        None => {
            warn!("AI agent configured but species-id service unavailable; skipping AI auto-ID");
            return;
        }
    };

    let response = match species_id
        .identify(&image_base64, latitude, longitude, Some(1))
        .await
    {
        Ok(r) => r,
        Err(e) => {
            warn!(error = %e, "species-id inference failed for AI auto-ID");
            return;
        }
    };

    let Some(top) = response.suggestions.into_iter().next() else {
        info!("species-id returned no suggestions; skipping AI auto-ID");
        return;
    };

    if !should_post(&top, state.ai_id_min_confidence, state.ai_id_in_range_only) {
        info!(
            scientific_name = %top.scientific_name,
            confidence = top.confidence,
            in_range = ?top.in_range,
            min_confidence = state.ai_id_min_confidence,
            "AI auto-ID gated; not posting"
        );
        return;
    }

    let record = match auto_id::build_identification_record(
        &state,
        &top.scientific_name,
        None,
        top.kingdom.as_deref(),
        &occurrence_uri,
        &occurrence_cid,
        Some(MODEL_NAME),
        Some(&response.model_version),
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            warn!(error = ?e, "Failed to build AI identification record");
            return;
        }
    };

    match ai_agent
        .create_record(auto_id::identification_nsid(), record)
        .await
    {
        Ok(resp) => info!(
            uri = %resp.uri,
            scientific_name = %top.scientific_name,
            ai_did = %ai_agent.did().as_str(),
            "AI auto-identification posted (PDS); awaiting ingester"
        ),
        Err(e) => warn!(error = ?e, "AI bot failed to post identification record"),
    }
}

/// Decide whether to publish a suggestion. Pulled out so future refinements
/// (per-model thresholds, range-confidence blending) live in one place.
fn should_post(top: &SpeciesSuggestion, min_confidence: f32, in_range_only: bool) -> bool {
    if top.confidence < min_confidence {
        return false;
    }
    if in_range_only && top.in_range == Some(false) {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn suggestion(confidence: f32, in_range: Option<bool>) -> SpeciesSuggestion {
        SpeciesSuggestion {
            scientific_name: "Quercus alba".into(),
            confidence,
            common_name: None,
            kingdom: Some("Plantae".into()),
            in_range,
        }
    }

    #[test]
    fn gates_below_min_confidence() {
        assert!(!should_post(&suggestion(0.10, None), 0.15, false));
    }

    #[test]
    fn passes_above_min_confidence() {
        assert!(should_post(&suggestion(0.20, None), 0.15, false));
    }

    #[test]
    fn passes_when_in_range_unknown_even_with_strict_mode() {
        assert!(should_post(&suggestion(0.20, None), 0.15, true));
    }

    #[test]
    fn gates_out_of_range_only_in_strict_mode() {
        assert!(!should_post(&suggestion(0.20, Some(false)), 0.15, true));
        assert!(should_post(&suggestion(0.20, Some(false)), 0.15, false));
    }
}
