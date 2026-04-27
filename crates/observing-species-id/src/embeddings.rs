//! Species embedding matrix for zero-shot classification
//!
//! At startup, the service loads:
//! - `species_embeddings.bin`: flat f32 array of shape [N, embed_dim], L2-normalized rows
//! - `species_labels.json`: array of species metadata objects
//!
//! The embedding dimension is inferred at load time from the file size and label
//! count, so any CLIP model variant (e.g. ViT-B/16 = 512-d, ViT-H/14 = 1024-d)
//! is supported without code changes.
//!
//! At inference time, cosine similarity between the image embedding and all
//! species embeddings is computed via a single matrix multiply.

use crate::error::{Result, SpeciesIdError};
use crate::types::SpeciesSuggestion;
use ndarray::{Array1, Array2};
use serde::Deserialize;
use std::path::Path;
use tracing::info;

/// Species label metadata loaded from JSON.
///
/// The on-disk labels file may include richer fields (phylum/class/order/
/// family/genus etc.) — serde silently ignores them. We only deserialize
/// the fields that the response actually carries.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesLabel {
    pub scientific_name: String,
    #[serde(default)]
    pub common_name: Option<String>,
    #[serde(default)]
    pub kingdom: Option<String>,
}

/// Pre-computed species embeddings and their metadata
pub struct SpeciesEmbeddings {
    /// Shape: [num_species, embed_dim], L2-normalized rows
    embeddings: Array2<f32>,
    /// Metadata for each species (same order as embedding rows)
    labels: Vec<SpeciesLabel>,
    /// Embedding dimension (inferred from file at load time)
    embed_dim: usize,
}

impl SpeciesEmbeddings {
    /// Load embeddings and labels from a model directory.
    ///
    /// Expects:
    /// - `{model_dir}/species_embeddings.bin` - raw f32 little-endian, shape [N, embed_dim]
    /// - `{model_dir}/species_labels.json` - JSON array of SpeciesLabel objects
    ///
    /// The embedding dimension is inferred from `file_size / (num_species * sizeof(f32))`.
    pub fn load(model_dir: &Path) -> Result<Self> {
        let embeddings_path = model_dir.join("species_embeddings.bin");
        let labels_path = model_dir.join("species_labels.json");

        // Load labels
        let labels_data = std::fs::read_to_string(&labels_path).map_err(|e| {
            SpeciesIdError::Config(format!(
                "Failed to read species labels from {}: {}",
                labels_path.display(),
                e
            ))
        })?;
        let labels: Vec<SpeciesLabel> = serde_json::from_str(&labels_data).map_err(|e| {
            SpeciesIdError::Config(format!("Failed to parse species labels: {}", e))
        })?;

        let num_species = labels.len();
        info!(num_species, "Loading species labels");

        // Load binary embeddings
        let embeddings_bytes = std::fs::read(&embeddings_path).map_err(|e| {
            SpeciesIdError::Config(format!(
                "Failed to read species embeddings from {}: {}",
                embeddings_path.display(),
                e
            ))
        })?;

        let total_floats = embeddings_bytes.len() / std::mem::size_of::<f32>();
        if embeddings_bytes.len() % std::mem::size_of::<f32>() != 0
            || !total_floats.is_multiple_of(num_species)
        {
            return Err(SpeciesIdError::Config(format!(
                "Embeddings file size ({} bytes) is not evenly divisible into {} species of f32 vectors",
                embeddings_bytes.len(),
                num_species
            )));
        }
        let embed_dim = total_floats / num_species;

        // Cast bytes to f32 slice
        let float_data: &[f32] = bytemuck::cast_slice(&embeddings_bytes);
        let embeddings = Array2::from_shape_vec((num_species, embed_dim), float_data.to_vec())
            .map_err(|e| SpeciesIdError::Config(format!("Failed to reshape embeddings: {}", e)))?;

        info!(
            num_species,
            embedding_dim = embed_dim,
            size_mb = embeddings_bytes.len() / (1024 * 1024),
            "Species embeddings loaded"
        );

        Ok(Self {
            embeddings,
            labels,
            embed_dim,
        })
    }

    /// Number of species in the label set
    pub fn len(&self) -> usize {
        self.labels.len()
    }

    /// Embedding dimension (inferred from the loaded model data)
    pub fn embed_dim(&self) -> usize {
        self.embed_dim
    }

    /// Cosine similarity between the image embedding and every species
    /// embedding. Both sides are expected to be L2-normalized, so the dot
    /// product is the cosine. Shape: `[num_species]`.
    pub fn similarities(&self, image_embedding: &Array1<f32>) -> Array1<f32> {
        self.embeddings.dot(image_embedding)
    }

    /// Pick the top-K highest scores and return them as suggestions.
    ///
    /// The caller owns the score array and can mutate it (e.g. applying a
    /// geo-prior boost) before calling this.
    ///
    /// `in_range`, if provided, is a sorted-ascending slice of species
    /// indices we consider "expected at the request location". Each
    /// returned suggestion gets `in_range = Some(true|false)`. Pass `None`
    /// when no geo lookup was performed; suggestions then carry
    /// `in_range = None` and the field is omitted from the wire response.
    pub fn top_k_from_scores(
        &self,
        scores: &[f32],
        k: usize,
        in_range: Option<&[u32]>,
    ) -> Vec<SpeciesSuggestion> {
        let mut indexed: Vec<(usize, f32)> = scores.iter().copied().enumerate().collect();
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_embeddings(rows: usize, embed_dim: usize) -> SpeciesEmbeddings {
        // Identity-ish: row i has a 1 at column (i % embed_dim), normalized.
        let mut data = vec![0.0f32; rows * embed_dim];
        for i in 0..rows {
            data[i * embed_dim + (i % embed_dim)] = 1.0;
        }
        let embeddings = Array2::from_shape_vec((rows, embed_dim), data).unwrap();
        let labels = (0..rows)
            .map(|i| SpeciesLabel {
                scientific_name: format!("Species {}", i),
                common_name: None,
                kingdom: None,
            })
            .collect();
        SpeciesEmbeddings {
            embeddings,
            labels,
            embed_dim,
        }
    }

    #[test]
    fn top_k_decorates_in_range_when_set_provided() {
        let species = make_embeddings(5, 4);
        let scores = vec![0.1, 0.5, 0.3, 0.4, 0.2];
        let in_range = vec![1u32, 3];

        let out = species.top_k_from_scores(&scores, 3, Some(&in_range));

        // Top-3 by score is species 1 (0.5), 3 (0.4), 2 (0.3).
        assert_eq!(out[0].scientific_name, "Species 1");
        assert_eq!(out[0].in_range, Some(true));
        assert_eq!(out[1].scientific_name, "Species 3");
        assert_eq!(out[1].in_range, Some(true));
        assert_eq!(out[2].scientific_name, "Species 2");
        assert_eq!(out[2].in_range, Some(false));
    }

    #[test]
    fn top_k_omits_in_range_when_no_geo_lookup() {
        let species = make_embeddings(3, 4);
        let scores = vec![0.1, 0.5, 0.3];

        let out = species.top_k_from_scores(&scores, 3, None);

        // None across the board → field is serialized as absent.
        for sugg in &out {
            assert_eq!(sugg.in_range, None);
        }
        let json = serde_json::to_string(&out[0]).unwrap();
        assert!(
            !json.contains("inRange"),
            "in_range should not appear in JSON when None: {}",
            json
        );
    }
}
