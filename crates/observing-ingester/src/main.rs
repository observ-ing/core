//! Observ.ing Ingester - High-performance AT Protocol firehose ingester
//!
//! This service connects to the AT Protocol firehose and indexes
//! biodiversity records (occurrences and identifications) to PostgreSQL.

mod database;
mod error;
mod firehose;
mod server;
mod types;

use crate::database::Database;
use crate::error::{IngesterError, Result};
use crate::firehose::{FirehoseConfig, FirehoseEvent, FirehoseSubscription};
use crate::server::{start_server, ServerState, SharedState};
use crate::types::{IngesterConfig, RecentEvent};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};
use tokio::time::interval;
use tracing::{error, info, warn};
use tracing_subscriber::{prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    let env_filter =
        EnvFilter::from_default_env().add_directive("observing_ingester=info".parse()?);

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

    info!("Starting Observ.ing Ingester (Rust)...");

    // Load configuration from environment
    let config = load_config()?;
    info!("Relay: {}", config.relay_url);
    info!("Port: {}", config.port);

    // Connect to database
    let db = Database::connect(&config.database_url).await?;
    db.migrate().await?;

    // Load saved cursor
    let saved_cursor = db.get_cursor().await?;
    let cursor = config.cursor.or(saved_cursor);

    if let Some(c) = cursor {
        info!("Resuming from cursor: {}", c);
    } else {
        info!("Starting from current firehose position (no cursor)");
    }

    // Create shared state for HTTP server
    let state: SharedState = Arc::new(RwLock::new(ServerState::new()));

    // Create channel for firehose events
    let (event_tx, mut event_rx) = mpsc::channel::<FirehoseEvent>(1000);

    // Spawn HTTP server
    let http_state = state.clone();
    let http_port = config.port;
    tokio::spawn(async move {
        if let Err(e) = start_server(http_state, http_port).await {
            error!("HTTP server error: {}", e);
        }
    });

    // Spawn firehose subscription
    let firehose_config = FirehoseConfig {
        relay: config.relay_url.clone(),
        cursor,
    };
    tokio::spawn(async move {
        let mut subscription = FirehoseSubscription::new(firehose_config, event_tx);
        if let Err(e) = subscription.run().await {
            error!("Firehose error: {}", e);
        }
    });

    // Spawn cursor saver (every 30 seconds)
    let cursor_db = Database::connect(&config.database_url).await?;
    let cursor_state = state.clone();
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(30));
        loop {
            ticker.tick().await;
            let cursor = cursor_state.read().await.cursor;
            if let Some(c) = cursor {
                if let Err(e) = cursor_db.save_cursor(c).await {
                    error!("Failed to save cursor: {}", e);
                }
            }
        }
    });

    // Process firehose events
    while let Some(event) = event_rx.recv().await {
        match event {
            FirehoseEvent::Connected => {
                info!("Connected to firehose");
                state.write().await.connected = true;
            }
            FirehoseEvent::Disconnected => {
                warn!("Disconnected from firehose");
                state.write().await.connected = false;
            }
            FirehoseEvent::Error(e) => {
                error!("Firehose error: {}", e);
                state.write().await.stats.errors += 1;
            }
            FirehoseEvent::Commit(timing) => {
                let mut s = state.write().await;
                s.cursor = Some(timing.seq);
                s.last_processed = Some(timing);
            }
            FirehoseEvent::Occurrence(event) => {
                let action = event.action.clone();
                let uri = event.uri.clone();

                let result = if action == "delete" {
                    db.delete_occurrence(&uri).await
                } else {
                    db.upsert_occurrence(&event).await
                };

                let mut s = state.write().await;
                if let Err(e) = result {
                    error!("Database error for occurrence {}: {}", uri, e);
                    s.stats.errors += 1;
                } else {
                    s.stats.occurrences += 1;
                    s.add_recent_event(RecentEvent {
                        event_type: "occurrence".to_string(),
                        action,
                        uri,
                        time: event.time,
                    });
                }
            }
            FirehoseEvent::Identification(event) => {
                let action = event.action.clone();
                let uri = event.uri.clone();

                let result = if action == "delete" {
                    db.delete_identification(&uri).await
                } else {
                    db.upsert_identification(&event).await
                };

                let mut s = state.write().await;
                if let Err(e) = result {
                    error!("Database error for identification {}: {}", uri, e);
                    s.stats.errors += 1;
                } else {
                    s.stats.identifications += 1;
                    s.add_recent_event(RecentEvent {
                        event_type: "identification".to_string(),
                        action,
                        uri,
                        time: event.time,
                    });
                }
            }
            FirehoseEvent::Comment(event) => {
                let action = event.action.clone();
                let uri = event.uri.clone();

                let result = if action == "delete" {
                    db.delete_comment(&uri).await
                } else {
                    db.upsert_comment(&event).await
                };

                let mut s = state.write().await;
                if let Err(e) = result {
                    error!("Database error for comment {}: {}", uri, e);
                    s.stats.errors += 1;
                } else {
                    s.stats.comments += 1;
                    s.add_recent_event(RecentEvent {
                        event_type: "comment".to_string(),
                        action,
                        uri,
                        time: event.time,
                    });
                }
            }
        }
    }

    Ok(())
}

fn load_config() -> Result<IngesterConfig> {
    // Support both DATABASE_URL and separate DB_* environment variables
    // (for compatibility with Cloud SQL socket connections)
    let database_url = if let Ok(url) = std::env::var("DATABASE_URL") {
        url
    } else {
        // Build URL from separate components (Cloud SQL style)
        let host = std::env::var("DB_HOST").map_err(|_| {
            IngesterError::Config(
                "DATABASE_URL or DB_HOST environment variable is required".to_string(),
            )
        })?;
        let name = std::env::var("DB_NAME").unwrap_or_else(|_| "observing".to_string());
        let user = std::env::var("DB_USER").unwrap_or_else(|_| "postgres".to_string());
        let password = std::env::var("DB_PASSWORD").unwrap_or_default();

        // Check if this is a Cloud SQL socket path
        if host.starts_with("/cloudsql/") {
            // Unix socket connection for Cloud SQL
            format!(
                "postgresql://{}:{}@localhost/{}?host={}",
                user, password, name, host
            )
        } else {
            // Regular TCP connection
            let port = std::env::var("DB_PORT").unwrap_or_else(|_| "5432".to_string());
            format!(
                "postgresql://{}:{}@{}:{}/{}",
                user, password, host, port, name
            )
        }
    };

    let relay_url = std::env::var("JETSTREAM_URL")
        .unwrap_or_else(|_| "wss://jetstream2.us-east.bsky.network/subscribe".to_string());

    let cursor = std::env::var("CURSOR")
        .ok()
        .and_then(|s| s.parse::<i64>().ok());

    let port = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(8080);

    Ok(IngesterConfig {
        relay_url,
        database_url,
        cursor,
        port,
    })
}
