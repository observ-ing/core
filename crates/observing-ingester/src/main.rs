//! Observ.ing Ingester - High-performance AT Protocol firehose ingester
//!
//! This service connects to the AT Protocol firehose and indexes
//! biodiversity records (occurrences and identifications) to PostgreSQL.

mod database;
mod error;
mod server;
mod types;

use crate::database::Database;
use crate::error::{IngesterError, Result};
use crate::server::{start_server, ServerState, SharedState};
use crate::types::{
    IngesterConfig, RecentEvent, COMMENT_COLLECTION, IDENTIFICATION_COLLECTION,
    INTERACTION_COLLECTION, LIKE_COLLECTION, OCCURRENCE_COLLECTION,
};
use chrono::Utc;
use jetstream_client::{JetstreamConfig, JetstreamEvent, JetstreamSubscription};
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

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_stackdriver::layer())
        .init();

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
    let (event_tx, mut event_rx) = mpsc::channel::<JetstreamEvent>(1000);

    // Spawn HTTP server
    let http_state = state.clone();
    let http_port = config.port;
    tokio::spawn(async move {
        if let Err(e) = start_server(http_state, http_port).await {
            error!("HTTP server error: {}", e);
        }
    });

    // Spawn firehose subscription
    let jetstream_config = JetstreamConfig {
        relay: config.relay_url.clone(),
        cursor,
        wanted_collections: vec![
            OCCURRENCE_COLLECTION.to_string(),
            IDENTIFICATION_COLLECTION.to_string(),
            COMMENT_COLLECTION.to_string(),
            INTERACTION_COLLECTION.to_string(),
            LIKE_COLLECTION.to_string(),
        ],
    };
    tokio::spawn(async move {
        let mut subscription = JetstreamSubscription::new(jetstream_config, event_tx);
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
            let state = cursor_state.read().await;
            if let Some(c) = state.cursor {
                if let Err(e) = cursor_db.save_cursor(c).await {
                    error!("Failed to save cursor: {}", e);
                }
            }
            if let Some(ref lp) = state.last_processed {
                let lag_secs = (Utc::now() - lp.time).num_seconds();
                info!(lag_secs, "ingester lag: {}s behind", lag_secs);
            }
        }
    });

    // Process firehose events
    while let Some(event) = event_rx.recv().await {
        match event {
            JetstreamEvent::Connected => {
                info!("Connected to firehose");
                state.write().await.connected = true;
            }
            JetstreamEvent::Disconnected => {
                warn!("Disconnected from firehose");
                state.write().await.connected = false;
            }
            JetstreamEvent::Error(e) => {
                error!("Firehose error: {}", e);
                state.write().await.stats.errors += 1;
            }
            JetstreamEvent::TimingUpdate(timing) => {
                let mut s = state.write().await;
                s.cursor = Some(timing.seq);
                s.last_processed = Some(timing);
            }
            JetstreamEvent::Commit(commit) => {
                let collection = commit.collection.as_str();
                let action = commit.operation.clone();
                let uri = commit.uri.clone();
                let time = commit.time;

                let (result, event_type) = match collection {
                    OCCURRENCE_COLLECTION => {
                        let r = if action == "delete" {
                            db.delete_occurrence(&uri).await
                        } else {
                            db.upsert_occurrence(&commit).await
                        };
                        (r, "occurrence")
                    }
                    IDENTIFICATION_COLLECTION => {
                        let r = if action == "delete" {
                            db.delete_identification(&uri).await
                        } else {
                            db.upsert_identification(&commit).await
                        };
                        (r, "identification")
                    }
                    COMMENT_COLLECTION => {
                        let r = if action == "delete" {
                            db.delete_comment(&uri).await
                        } else {
                            db.upsert_comment(&commit).await
                        };
                        (r, "comment")
                    }
                    INTERACTION_COLLECTION => {
                        let r = if action == "delete" {
                            db.delete_interaction(&uri).await
                        } else {
                            db.upsert_interaction(&commit).await
                        };
                        (r, "interaction")
                    }
                    LIKE_COLLECTION => {
                        // Filter: only process likes whose subject is an occurrence
                        let is_occurrence_like = commit
                            .record
                            .as_ref()
                            .and_then(|r| r.get("subject"))
                            .and_then(|s| s.get("uri"))
                            .and_then(|u| u.as_str())
                            .is_some_and(|uri| uri.contains(OCCURRENCE_COLLECTION));

                        if is_occurrence_like || action == "delete" {
                            let r = if action == "delete" {
                                db.delete_like(&uri).await
                            } else {
                                db.upsert_like(&commit).await
                            };
                            (r, "like")
                        } else {
                            continue;
                        }
                    }
                    _ => continue,
                };

                let mut s = state.write().await;
                if let Err(e) = result {
                    error!("Database error for {} {}: {}", event_type, uri, e);
                    s.stats.errors += 1;
                } else {
                    match event_type {
                        "occurrence" => s.stats.occurrences += 1,
                        "identification" => s.stats.identifications += 1,
                        "comment" => s.stats.comments += 1,
                        "interaction" => s.stats.interactions += 1,
                        "like" => s.stats.likes += 1,
                        _ => {}
                    }
                    s.add_recent_event(RecentEvent {
                        event_type: event_type.to_string(),
                        action,
                        uri,
                        time,
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
