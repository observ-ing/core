//! BioCLIP ONNX model loading and inference
//!
//! Loads a BioCLIP vision encoder as an ONNX model and runs inference to
//! produce image embeddings for zero-shot species classification.

use crate::embeddings::SpeciesEmbeddings;
use crate::error::{Result, SpeciesIdError};
use crate::geo_index::GeoIndex;
use crate::preprocessing;
use crate::types::SpeciesSuggestion;
use ndarray::Array1;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Value;
use std::path::Path;
use std::sync::Mutex;
use tracing::{info, warn};

/// Default additive boost applied to in-range species when lat/lon is
/// provided. Chosen so a +λ bump is meaningful against typical BioCLIP
/// cosine similarities (~0.1–0.3 for matches) without overwhelming visual
/// evidence. Can be overridden at runtime via `GEO_BOOST_LAMBDA`.
const GEO_BOOST_DEFAULT: f32 = 0.05;

/// BioCLIP model wrapping the ONNX vision encoder and species embeddings
pub struct BioclipModel {
    session: Mutex<Session>,
    species: SpeciesEmbeddings,
    geo_index: Option<GeoIndex>,
    geo_boost: f32,
    pub version: String,
}

impl BioclipModel {
    /// Load the BioCLIP model from a directory.
    ///
    /// Expects:
    /// - `{model_dir}/vision_encoder.onnx` - BioCLIP vision encoder
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

        // Geo index is optional: if the artifact isn't present we fall back
        // to visual-only ranking (prior behavior).
        let geo_index_path = model_dir.join("species_geo_index.bin");
        let geo_index = if geo_index_path.exists() {
            Some(GeoIndex::load(&geo_index_path, species.len())?)
        } else {
            warn!(
                path = %geo_index_path.display(),
                "Geo index not found; species identification will use visual similarity only"
            );
            None
        };

        let geo_boost = std::env::var("GEO_BOOST_LAMBDA")
            .ok()
            .and_then(|s| s.parse::<f32>().ok())
            .unwrap_or(GEO_BOOST_DEFAULT);
        if geo_index.is_some() {
            info!(geo_boost, "Geo-prior reranking enabled");
        }

        Ok(Self {
            session: Mutex::new(session),
            species,
            geo_index,
            geo_boost,
            version: "bioclip-2.5-vit-h-14".to_string(),
        })
    }

    /// Number of species in the label set
    pub fn species_count(&self) -> usize {
        self.species.len()
    }

    /// Identify species from raw image bytes.
    ///
    /// If `lat_lon` is provided and a geo index is loaded, species whose iNat
    /// range covers that point get a soft additive boost before top-K
    /// selection. Missing lat/lon or missing index falls back to visual-only
    /// ranking.
    ///
    /// Returns the top-K species suggestions sorted by descending confidence.
    pub fn identify(
        &self,
        image_bytes: &[u8],
        lat_lon: Option<(f64, f64)>,
        limit: usize,
    ) -> Result<Vec<SpeciesSuggestion>> {
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

        // Validate expected shape [1, embed_dim]
        let embed_dim = self.species.embed_dim();
        if shape.len() != 2 || shape[1] != embed_dim as i64 {
            return Err(SpeciesIdError::Model(format!(
                "Unexpected embedding shape: {:?}, expected [1, {}]",
                &**shape, embed_dim
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

        // Cosine similarities against every species.
        let mut scores = self.species.similarities(&embedding).to_vec();

        // Geo-prior rerank: boost species whose range maps cover this lat/lon.
        // Soft boost only — never penalize out-of-range species, because iNat
        // range maps undercover species in under-surveyed regions.
        if let (Some((lat, lon)), Some(geo)) = (lat_lon, &self.geo_index) {
            let in_range = geo.species_at(lat, lon);
            for &species_idx in in_range {
                if let Some(s) = scores.get_mut(species_idx as usize) {
                    *s += self.geo_boost;
                }
            }
            info!(
                lat,
                lon,
                in_range = in_range.len(),
                boost = self.geo_boost,
                "Applied geo prior"
            );
        }

        Ok(self.species.top_k_from_scores(&scores, limit))
    }
}
