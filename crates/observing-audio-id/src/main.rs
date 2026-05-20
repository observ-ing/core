//! Observ.ing Audio (Bioacoustic) Identification Service
//!
//! Perch 2.0 based species identification from short audio clips. Mirrors
//! the shape of `observing-species-id` so the appview can wire it in with
//! the same pattern (HTTP, base64 payload, top-K suggestions, optional
//! geo-prior reranking).

mod embeddings;
mod error;
mod geo_index;
mod model;
mod preprocessing;
mod server;
mod types;

use crate::error::{AudioIdError, Result};
use crate::model::PerchModel;
use crate::server::{start_server, ServerState, SharedState};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;
use tracing_subscriber::{prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> Result<()> {
    let env_filter =
        EnvFilter::from_default_env().add_directive("observing_audio_id=info".parse()?);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_stackdriver::layer())
        .init();

    info!("Starting Observ.ing Audio Identification Service...");

    let port = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(3006);

    let model_dir = std::env::var("MODEL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("models/perch"));

    info!(port, model_dir = %model_dir.display(), "Configuration loaded");

    let model = PerchModel::load(&model_dir)?;

    info!(
        species_count = model.species_count(),
        version = %model.version,
        "Model loaded successfully"
    );

    let state: SharedState = Arc::new(ServerState {
        model,
        started_at: chrono::Utc::now(),
    });

    start_server(state, port)
        .await
        .map_err(|e| AudioIdError::Config(format!("Server error: {}", e)))?;

    Ok(())
}
