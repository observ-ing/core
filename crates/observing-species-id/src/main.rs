//! Observ.ing Species Identification Service
//!
//! BioCLIP-based species identification from photos using ONNX Runtime.

mod detector;
mod embeddings;
mod error;
mod model;
mod preprocessing;
mod server;
mod types;

use crate::detector::OrganismDetector;
use crate::error::{Result, SpeciesIdError};
use crate::model::BioclipModel;
use crate::server::{start_server, ServerState, SharedState};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;
use tracing_subscriber::{prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    let env_filter =
        EnvFilter::from_default_env().add_directive("observing_species_id=info".parse()?);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_stackdriver::layer())
        .init();

    info!("Starting Observ.ing Species Identification Service...");

    let port = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(3005);

    let model_dir = std::env::var("MODEL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("models/bioclip"));

    info!(port, model_dir = %model_dir.display(), "Configuration loaded");

    // Load model (this may take a few seconds)
    let model = BioclipModel::load(&model_dir)?;

    info!(
        species_count = model.species_count(),
        version = %model.version,
        "Model loaded successfully"
    );

    // Prototype organism detector for `/detect`. Optional: without its files
    // the service runs as before and `/detect` answers 503.
    let detector_dir = std::env::var("DETECTOR_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("models/detector"));
    let detector = if detector_dir.join("detector.onnx").exists() {
        Some(OrganismDetector::load(&detector_dir)?)
    } else {
        info!(
            dir = %detector_dir.display(),
            "Organism detector not found; /detect is disabled"
        );
        None
    };

    let state: SharedState = Arc::new(ServerState {
        model,
        detector,
        started_at: chrono::Utc::now(),
    });

    start_server(state, port)
        .await
        .map_err(|e| SpeciesIdError::Config(format!("Server error: {}", e)))?;

    Ok(())
}
