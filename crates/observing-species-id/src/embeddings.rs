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
        if embeddings_bytes.len() % std::mem::size_of::<f32>() != 0 || !total_floats.is_multiple_of(num_species) {
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

        Ok(Self { embeddings, labels, embed_dim })
    }

    /// Number of species in the label set
    pub fn len(&self) -> usize {
        self.labels.len()
    }

    /// Embedding dimension (inferred from the loaded model data)
    pub fn embed_dim(&self) -> usize {
        self.embed_dim
    }

    /// Find the top-K most similar species to the given image embedding.
    ///
    /// `image_embedding` must be L2-normalized, shape [embed_dim].
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
