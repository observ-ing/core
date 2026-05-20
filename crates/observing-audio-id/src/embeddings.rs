//! Species label table for Perch 2.0.
//!
//! Unlike BioCLIP (zero-shot via text embeddings), Perch is a supervised
//! classifier with a fixed output head over ~15k species + ~200 general
//! sound-event classes. So this file is much simpler than its species-id
//! counterpart: just a parallel array of labels matched to the ONNX
//! output's class index.

use crate::error::{AudioIdError, Result};
use crate::types::SpeciesSuggestion;
use serde::Deserialize;
use std::path::Path;
use tracing::info;

/// One row in the Perch class table.
///
/// The on-disk file may include richer fields (kingdom/family/etc.) — serde
/// silently ignores them. `is_species` distinguishes the ~15k biological
/// classes from the ~200 "general sound events" (rain, chainsaw, dog bark)
/// that we filter out before returning suggestions.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesLabel {
    pub scientific_name: String,
    #[serde(default)]
    pub common_name: Option<String>,
    #[serde(default)]
    pub kingdom: Option<String>,
    /// True for species classes, false for general sound events.
    #[serde(default = "default_is_species")]
    pub is_species: bool,
}

fn default_is_species() -> bool {
    true
}

pub struct SpeciesLabels {
    labels: Vec<SpeciesLabel>,
}

impl SpeciesLabels {
    /// Load labels from `{model_dir}/species_labels.json`. The order in the
    /// file must match the class index ordering of the ONNX output head.
    pub fn load(model_dir: &Path) -> Result<Self> {
        let path = model_dir.join("species_labels.json");
        let raw = std::fs::read_to_string(&path).map_err(|e| {
            AudioIdError::Config(format!(
                "Failed to read species labels from {}: {}",
                path.display(),
                e
            ))
        })?;
        let labels: Vec<SpeciesLabel> = serde_json::from_str(&raw)
            .map_err(|e| AudioIdError::Config(format!("Failed to parse species labels: {}", e)))?;
        info!(
            num_classes = labels.len(),
            num_species = labels.iter().filter(|l| l.is_species).count(),
            "Perch labels loaded"
        );
        Ok(Self { labels })
    }

    pub fn len(&self) -> usize {
        self.labels.len()
    }

    /// Pick the top-K species suggestions from a logits/score vector.
    ///
    /// Non-species classes (general sound events) are skipped before
    /// ranking — the appview only wants taxa, and surfacing "chainsaw" in
    /// an ID dropdown would be confusing.
    ///
    /// `in_range`, if provided, is a sorted-ascending slice of class
    /// indices we consider expected at the request location; matching
    /// suggestions get `in_range = Some(true)`, others `Some(false)`.
    /// Pass `None` when no geo lookup was performed.
    pub fn top_k_from_scores(
        &self,
        scores: &[f32],
        k: usize,
        in_range: Option<&[u32]>,
    ) -> Vec<SpeciesSuggestion> {
        let mut indexed: Vec<(usize, f32)> = scores
            .iter()
            .copied()
            .enumerate()
            .filter(|(i, _)| self.labels.get(*i).is_some_and(|l| l.is_species))
            .collect();
        indexed.sort_unstable_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        indexed.truncate(k);

        indexed
            .into_iter()
            .map(|(idx, score)| {
                let label = &self.labels[idx];
                let in_range = in_range.map(|set| set.binary_search(&(idx as u32)).is_ok());
                SpeciesSuggestion {
                    scientific_name: label.scientific_name.clone(),
                    confidence: score,
                    common_name: label.common_name.clone(),
                    kingdom: label.kingdom.clone(),
                    in_range,
                }
            })
            .collect()
    }
}
