//! Species embedding matrix for zero-shot classification
//!
//! At startup, the service loads:
//! - `species_embeddings.bin`: flat f32 array of shape [N, 512], L2-normalized rows
//! - `species_labels.json`: array of species metadata objects
//!
//! At inference time, cosine similarity between the image embedding and all
//! species embeddings is computed via a single matrix multiply.

use crate::error::{Result, SpeciesIdError};
use crate::types::SpeciesSuggestion;
use ndarray::{Array1, Array2};
use serde::Deserialize;
use std::path::Path;
use tracing::info;

/// Embedding dimension for BioCLIP (ViT-B/16 CLIP)
const EMBED_DIM: usize = 512;

/// Species label metadata loaded from JSON
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesLabel {
    pub scientific_name: String,
    #[serde(default)]
    pub common_name: Option<String>,
    #[serde(default)]
    pub kingdom: Option<String>,
    #[serde(default)]
    pub phylum: Option<String>,
    #[serde(default)]
    pub class: Option<String>,
    #[serde(default)]
    pub order: Option<String>,
    #[serde(default)]
    pub family: Option<String>,
    #[serde(default)]
    pub genus: Option<String>,
}

/// Pre-computed species embeddings and their metadata
pub struct SpeciesEmbeddings {
    /// Shape: [num_species, 512], L2-normalized rows
    embeddings: Array2<f32>,
    /// Metadata for each species (same order as embedding rows)
    labels: Vec<SpeciesLabel>,
}

impl SpeciesEmbeddings {
    /// Load embeddings and labels from a model directory.
    ///
    /// Expects:
    /// - `{model_dir}/species_embeddings.bin` - raw f32 little-endian, shape [N, 512]
    /// - `{model_dir}/species_labels.json` - JSON array of SpeciesLabel objects
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

        let expected_bytes = num_species * EMBED_DIM * std::mem::size_of::<f32>();
        if embeddings_bytes.len() != expected_bytes {
            return Err(SpeciesIdError::Config(format!(
                "Embeddings file size mismatch: expected {} bytes ({} species x {} dims x 4), got {}",
                expected_bytes,
                num_species,
                EMBED_DIM,
                embeddings_bytes.len()
            )));
        }

        // Cast bytes to f32 slice
        let float_data: &[f32] = bytemuck::cast_slice(&embeddings_bytes);
        let embeddings = Array2::from_shape_vec((num_species, EMBED_DIM), float_data.to_vec())
            .map_err(|e| SpeciesIdError::Config(format!("Failed to reshape embeddings: {}", e)))?;

        info!(
            num_species,
            embedding_dim = EMBED_DIM,
            size_mb = embeddings_bytes.len() / (1024 * 1024),
            "Species embeddings loaded"
        );

        Ok(Self { embeddings, labels })
    }

    /// Number of species in the label set
    pub fn len(&self) -> usize {
        self.labels.len()
    }

    /// Find the top-K most similar species to the given image embedding.
    ///
    /// `image_embedding` must be L2-normalized, shape [512].
    /// Returns suggestions sorted by descending confidence.
    pub fn top_k(&self, image_embedding: &Array1<f32>, k: usize) -> Vec<SpeciesSuggestion> {
        // Cosine similarity = dot product (both are L2-normalized)
        let similarities = self.embeddings.dot(image_embedding);

        // Find top-K indices
        let mut indexed: Vec<(usize, f32)> = similarities.iter().copied().enumerate().collect();
        indexed.sort_unstable_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        indexed.truncate(k);

        indexed
            .into_iter()
            .map(|(idx, score)| {
                let label = &self.labels[idx];
                SpeciesSuggestion {
                    scientific_name: label.scientific_name.clone(),
                    confidence: score,
                    common_name: label.common_name.clone(),
                    kingdom: label.kingdom.clone(),
                    phylum: label.phylum.clone(),
                    class: label.class.clone(),
                    order: label.order.clone(),
                    family: label.family.clone(),
                    genus: label.genus.clone(),
                }
            })
            .collect()
    }
}
