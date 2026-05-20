//! Perch 2.0 ONNX model loading and inference.
//!
//! Loads Google DeepMind's Perch 2.0 supervised bioacoustic classifier
//! (Justin Chu's community ONNX export) and runs inference over 5-second
//! audio frames to produce per-class scores.
//!
//! Per-clip ranking strategy:
//! - Run the model on every 5s frame produced by `preprocessing::frame`.
//! - Per-class score for the clip = max across frames (a vocalization that
//!   only happens in one second of a long clip shouldn't be diluted by
//!   silent frames before/after).
//! - Apply optional geo-prior boost, then take top-K.
//!
//! Output head shape, exact input name, and class ordering all need to be
//! pinned to the specific ONNX bundle that's shipped to the model dir —
//! see the TODOs inline for the bits that need to be confirmed against
//! `models/perch/vision_encoder.onnx` (analog: Perch's audio encoder).

use crate::embeddings::SpeciesLabels;
use crate::error::{AudioIdError, Result};
use crate::geo_index::GeoIndex;
use crate::preprocessing::{self, FramedAudio};
use crate::types::SpeciesSuggestion;
use ndarray::{Array1, Array2};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Value;
use std::path::Path;
use std::sync::Mutex;
use tracing::{info, warn};

/// Default additive boost applied to in-range classes when lat/lon is
/// provided. Chosen on the same scale as the species-id geo boost — Perch
/// logits are larger than BioCLIP cosines, so this may want retuning once
/// real data is in; controlled at runtime via `GEO_BOOST_LAMBDA`.
const GEO_BOOST_DEFAULT: f32 = 0.05;

pub struct PerchModel {
    session: Mutex<Session>,
    labels: SpeciesLabels,
    geo_index: Option<GeoIndex>,
    geo_boost: f32,
    pub version: String,
}

impl PerchModel {
    /// Load the Perch model from a directory.
    ///
    /// Expects:
    /// - `{model_dir}/audio_encoder.onnx` — Perch 2.0 ONNX bundle (the one
    ///   exported with the mel-spectrogram baked into the graph; input is
    ///   raw mono f32 PCM at 32 kHz)
    /// - `{model_dir}/species_labels.json` — class label table, ordered to
    ///   match the ONNX output head
    /// - `{model_dir}/species_geo_index.bin` (optional) — same format as
    ///   the species-id service uses
    pub fn load(model_dir: &Path) -> Result<Self> {
        let onnx_path = model_dir.join("audio_encoder.onnx");
        info!(path = %onnx_path.display(), "Loading Perch ONNX bundle");

        let session = Session::builder()
            .map_err(|e| AudioIdError::Model(e.to_string()))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| AudioIdError::Model(e.to_string()))?
            .with_intra_threads(4)
            .map_err(|e| AudioIdError::Model(e.to_string()))?
            .commit_from_file(&onnx_path)
            .map_err(|e| {
                AudioIdError::Model(format!(
                    "Failed to load ONNX model from {}: {}",
                    onnx_path.display(),
                    e
                ))
            })?;

        info!("Perch ONNX bundle loaded");

        let labels = SpeciesLabels::load(model_dir)?;

        let geo_index_path = model_dir.join("species_geo_index.bin");
        let geo_index = if geo_index_path.exists() {
            match GeoIndex::load(&geo_index_path, labels.len()) {
                Ok(g) => Some(g),
                Err(e) => {
                    warn!(error = %e, "Geo index load failed; falling back to audio-only ranking");
                    None
                }
            }
        } else {
            warn!(
                path = %geo_index_path.display(),
                "Geo index not found; audio identification will use audio-only ranking"
            );
            None
        };

        let geo_boost = std::env::var("GEO_BOOST_LAMBDA")
            .ok()
            .and_then(|s| s.parse::<f32>().ok())
            .unwrap_or(GEO_BOOST_DEFAULT);

        Ok(Self {
            session: Mutex::new(session),
            labels,
            geo_index,
            geo_boost,
            version: "perch-2.0".to_string(),
        })
    }

    pub fn species_count(&self) -> usize {
        self.labels.len()
    }

    /// Identify species from raw audio bytes.
    ///
    /// Returns the top-K species suggestions sorted by descending score, and
    /// the decoded clip's duration (for the response).
    pub fn identify(
        &self,
        audio_bytes: &[u8],
        lat_lon: Option<(f64, f64)>,
        limit: usize,
    ) -> Result<(Vec<SpeciesSuggestion>, f32)> {
        let FramedAudio {
            frames,
            duration_secs,
        } = preprocessing::preprocess_audio(audio_bytes)?;

        let scores = self.run_perch_max_pool(frames)?;
        let mut scores = scores.to_vec();

        let in_range = self.in_range_at(lat_lon);
        self.apply_geo_prior(&mut scores, lat_lon, in_range);

        Ok((
            self.labels.top_k_from_scores(&scores, limit, in_range),
            duration_secs,
        ))
    }

    /// Run the Perch encoder on every frame and max-pool per class.
    ///
    /// We feed frames one at a time and reduce in-place rather than
    /// batching, because (a) the typical clip will be one or two frames,
    /// (b) the largest expected upload (a few minutes) is still only a
    /// few dozen frames, and (c) it keeps the session lock held for as
    /// short a span as possible per call.
    fn run_perch_max_pool(&self, frames: Array2<f32>) -> Result<Array1<f32>> {
        let num_frames = frames.shape()[0];
        let num_classes = self.labels.len();
        let mut pooled = Array1::<f32>::from_elem(num_classes, f32::NEG_INFINITY);

        let mut session = self
            .session
            .lock()
            .map_err(|e| AudioIdError::Model(format!("Session lock poisoned: {}", e)))?;

        for f in 0..num_frames {
            let frame = frames
                .row(f)
                .to_owned()
                .into_shape_with_order((1, preprocessing::WINDOW_SAMPLES))
                .map_err(|e| AudioIdError::Model(format!("Frame reshape: {}", e)))?;

            let input_value = Value::from_array(frame).map_err(|e| {
                AudioIdError::Model(format!("Failed to create input tensor: {}", e))
            })?;

            // TODO: confirm input name against the actual ONNX bundle once
            // we settle on which Perch export to ship. Justin Chu's bundle
            // uses "audio" for the raw-waveform variant.
            let outputs = session
                .run(ort::inputs!["audio" => input_value])
                .map_err(|e| AudioIdError::Model(format!("Inference failed: {}", e)))?;

            let (shape, data) = outputs[0]
                .try_extract_tensor::<f32>()
                .map_err(|e| AudioIdError::Model(format!("Failed to extract logits: {}", e)))?;
            if shape.len() != 2 || shape[1] as usize != num_classes {
                return Err(AudioIdError::Model(format!(
                    "Unexpected output shape: {:?}, expected [1, {}]",
                    &**shape, num_classes
                )));
            }
            for (i, &v) in data.iter().enumerate() {
                if v > pooled[i] {
                    pooled[i] = v;
                }
            }
        }

        // Any class never seen positive across frames becomes 0 instead of
        // -inf so downstream ranking / boosting is well-defined.
        for v in pooled.iter_mut() {
            if !v.is_finite() {
                *v = 0.0;
            }
        }
        Ok(pooled)
    }

    /// Same shape as species-id's `in_range_at`. See that file for the
    /// rationale on `None` vs `Some(empty)` and why we don't down-rank
    /// out-of-range classes.
    fn in_range_at(&self, lat_lon: Option<(f64, f64)>) -> Option<&[u32]> {
        let (lat, lon) = lat_lon?;
        let geo = self.geo_index.as_ref()?;
        let cell = geo.species_at(lat, lon);
        if cell.is_empty() {
            None
        } else {
            Some(cell)
        }
    }

    fn apply_geo_prior(
        &self,
        scores: &mut [f32],
        lat_lon: Option<(f64, f64)>,
        in_range: Option<&[u32]>,
    ) {
        let Some(in_range) = in_range else { return };
        for &idx in in_range {
            if let Some(s) = scores.get_mut(idx as usize) {
                *s += self.geo_boost;
            }
        }
        if let Some((lat, lon)) = lat_lon {
            info!(
                lat,
                lon,
                in_range = in_range.len(),
                boost = self.geo_boost,
                "Applied geo prior"
            );
        }
    }
}
