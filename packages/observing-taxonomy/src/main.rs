//! Observ.ing Taxonomy Service - GBIF taxonomy resolver
//!
//! This service provides taxonomy lookups via the GBIF API with caching.

mod error;
mod gbif;
mod server;
mod types;

use crate::error::{Result, TaxonomyError};
use crate::gbif::GbifClient;
use crate::server::{start_server, ServerState, SharedState};
use std::sync::Arc;
use tracing::info;
use tracing_subscriber::{prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    let env_filter =
        EnvFilter::from_default_env().add_directive("observing_taxonomy=info".parse()?);

    // Use JSON format for GCP Cloud Logging when LOG_FORMAT=json
    if std::env::var("LOG_FORMAT")
        .map(|v| v == "json")
        .unwrap_or(false)
    {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_stackdriver::layer())
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(env_filter).init();
    };

    info!("Starting Observ.ing Taxonomy Service (Rust)...");

    // Load configuration from environment
    let port = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(3003);

    info!("Port: {}", port);

    // Create GBIF client
    let client = GbifClient::new();

    // Create shared state
    let state: SharedState = Arc::new(ServerState::new(client));

    // Start HTTP server (blocking)
    start_server(state, port)
        .await
        .map_err(|e| TaxonomyError::Config(format!("Server error: {}", e)))?;

    Ok(())
}
