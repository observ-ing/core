//! BioCLIP ONNX model loading and inference
//!
//! Loads the BioCLIP ViT-B/16 vision encoder as an ONNX model and runs
//! inference to produce image embeddings for zero-shot species classification.

use crate::embeddings::SpeciesEmbeddings;
use crate::error::{Result, SpeciesIdError};
use crate::preprocessing;
use crate::types::SpeciesSuggestion;
use ndarray::Array1;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Value;
use std::path::Path;
use std::sync::Mutex;
use tracing::info;

/// BioCLIP model wrapping the ONNX vision encoder and species embeddings
pub struct BioclipModel {
    session: Mutex<Session>,
    species: SpeciesEmbeddings,
    pub version: String,
}

impl BioclipModel {
    /// Load the BioCLIP model from a directory.
    ///
    /// Expects:
    /// - `{model_dir}/vision_encoder.onnx` - BioCLIP ViT-B/16 vision encoder
    /// - `{model_dir}/species_embeddings.bin` - pre-computed text embeddings
    /// - `{model_dir}/species_labels.json` - species metadata
    pub fn load(model_dir: &Path) -> Result<Self> {
        let onnx_path = model_dir.join("vision_encoder.onnx");

        info!(path = %onnx_path.display(), "Loading ONNX vision encoder");

        let session = Session::builder()
            .map_err(|e| SpeciesIdError::Model(e.to_string()))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| SpeciesIdError::Model(e.to_string()))?
            .with_intra_threads(4)
            .map_err(|e| SpeciesIdError::Model(e.to_string()))?
            .commit_from_file(&onnx_path)
            .map_err(|e| {
                SpeciesIdError::Model(format!(
                    "Failed to load ONNX model from {}: {}",
                    onnx_path.display(),
                    e
                ))
            })?;

        info!("ONNX vision encoder loaded");

        let species = SpeciesEmbeddings::load(model_dir)?;

        Ok(Self {
            session: Mutex::new(session),
            species,
            version: "bioclip-vit-b-16".to_string(),
        })
    }

    /// Number of species in the label set
    pub fn species_count(&self) -> usize {
        self.species.len()
    }

    /// Identify species from raw image bytes.
    ///
    /// Returns the top-K species suggestions sorted by confidence.
    pub fn identify(&self, image_bytes: &[u8], limit: usize) -> Result<Vec<SpeciesSuggestion>> {
        // Preprocess image to NCHW tensor [1, 3, 224, 224]
        let input_tensor = preprocessing::preprocess_image(image_bytes)?;

        // Create ONNX Value from ndarray
        let input_value = Value::from_array(input_tensor)
            .map_err(|e| SpeciesIdError::Model(format!("Failed to create input tensor: {}", e)))?;

        // Run ONNX inference (session.run requires &mut self)
        let mut session = self
            .session
            .lock()
            .map_err(|e| SpeciesIdError::Model(format!("Session lock poisoned: {}", e)))?;

        let outputs = session
            .run(ort::inputs!["pixel_values" => input_value])
            .map_err(|e| SpeciesIdError::Model(format!("Inference failed: {}", e)))?;

        // Extract image embedding — returns (&Shape, &[f32])
        // Copy data out so we can release the session lock
        let (shape, data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| SpeciesIdError::Model(format!("Failed to extract embedding: {}", e)))?;

        // Validate expected shape [1, 512]
        if shape.len() != 2 || shape[1] != 512 {
            return Err(SpeciesIdError::Model(format!(
                "Unexpected embedding shape: {:?}, expected [1, 512]",
                &**shape
            )));
        }

        let embedding_data = data.to_vec();

        // Drop outputs and session lock
        drop(outputs);
        drop(session);

        // L2-normalize the image embedding
        let mut embedding = Array1::<f32>::from_vec(embedding_data);
        let norm = embedding.dot(&embedding).sqrt();
        if norm > 0.0 {
            embedding /= norm;
        }

        // Find top-K matches via cosine similarity
        Ok(self.species.top_k(&embedding, limit))
    }
}
