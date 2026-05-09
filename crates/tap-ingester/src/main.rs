//! AT Protocol ingester sourced from a Tap (indigo cmd/tap) instance.
//!
//! Two modes:
//! - **Spawn-inline (default):** uses `tapped::TapProcess::spawn_default` to
//!   launch the bundled `tap` binary as a child process, then talks to it
//!   over WebSocket on localhost. The image's Dockerfile puts `tap` on
//!   PATH; production deploy targets this mode.
//! - **Connect-existing:** if `TAP_URL` is set, skip spawning and connect
//!   to an existing Tap instance. Useful for local dev where Tap is
//!   already running in Docker.
//!
//! Writes events into the same `ingester` schema observing-ingester uses.
//! Idempotent upserts on `(uri, cid)` mean both ingesters can run
//! side-by-side during the verification window without colliding.
//!
//! Required env vars (one of):
//!   DATABASE_URL          Postgres connection string, OR
//!   DB_HOST + DB_NAME + DB_USER + DB_PASSWORD   (Cloud SQL socket style)
//!
//! Optional env vars:
//!   TAP_URL               If set, skip spawning Tap and connect to this URL.
//!   TAP_ADMIN_PASSWORD    Basic auth password (passed to spawned Tap or used
//!                         when connecting to an existing one).
//!   TAP_DATABASE_URL      Backing DB for the embedded Tap. Default
//!                         `sqlite:///data/tap.db`. /data is the Dockerfile
//!                         work dir; on Cloud Run it's instance-ephemeral.
//!   PORT                  HTTP server port (default 8080).

use std::sync::Arc;

use chrono::Utc;
use clap::Parser;
use jetstream_client::CommitInfo;
use observing_ingester::{
    server::{start_server, ServerState, SharedState},
    types::{
        RecentEvent, COMMENT_COLLECTION, IDENTIFICATION_COLLECTION, INTERACTION_COLLECTION,
        LIKE_COLLECTION, OCCURRENCE_COLLECTION,
    },
    Database,
};
use tapped::{Event, LogLevel, RecordAction, RecordEvent, TapClient, TapConfig, TapProcess};
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use tracing_subscriber::{prelude::*, EnvFilter};

#[derive(Parser)]
#[command(about = "Observ.ing AT Protocol Tap-sourced ingester")]
struct Cli {}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _cli = Cli::parse();

    let env_filter = EnvFilter::from_default_env().add_directive("tap_ingester=info".parse()?);
    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_stackdriver::layer())
        .init();

    info!("Starting Observ.ing tap-ingester...");

    let database_url = resolve_database_url()?;
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8080);

    let state: SharedState = Arc::new(RwLock::new(ServerState::new()));

    // Spawn HTTP server immediately so Cloud Run health checks pass.
    let http_state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = start_server(http_state, port).await {
            error!("HTTP server error: {}", e);
        }
    });

    let db = Database::connect(&database_url).await?;

    // Bring up Tap. If TAP_URL is set we treat it as already running;
    // otherwise spawn the bundled binary as a child process. The
    // _process handle keeps the spawned Tap alive for the lifetime of
    // this binary (kill_on_drop).
    let admin_password = std::env::var("TAP_ADMIN_PASSWORD").ok();
    let (_process, tap) = match std::env::var("TAP_URL") {
        Ok(url) => {
            info!(tap_url = %url, "TAP_URL set, connecting to existing Tap");
            let client = match admin_password {
                Some(pw) => TapClient::with_auth(&url, pw)?,
                None => TapClient::new(&url)?,
            };
            (None, client)
        }
        Err(_) => {
            info!("spawning embedded tap process");
            let mut builder = TapConfig::builder()
                .database_url(
                    std::env::var("TAP_DATABASE_URL")
                        .unwrap_or_else(|_| "sqlite:///data/tap.db".to_string()),
                )
                .signal_collection(OCCURRENCE_COLLECTION)
                .collection_filter(OCCURRENCE_COLLECTION)
                .collection_filter(IDENTIFICATION_COLLECTION)
                .collection_filter(COMMENT_COLLECTION)
                .collection_filter(INTERACTION_COLLECTION)
                .collection_filter(LIKE_COLLECTION)
                .log_level(LogLevel::Info);
            if let Some(pw) = admin_password.as_deref() {
                builder = builder.admin_password(pw.to_string());
            }
            let process = TapProcess::spawn_default(builder.build()).await?;
            let client = process.client()?;
            (Some(process), client)
        }
    };

    info!("connecting to tap channel");
    let mut channel = tap.channel().await?;
    state.write().await.connected = true;
    info!("tap channel connected");

    while let Ok(received) = channel.recv().await {
        let mut should_ack = true;
        match &received.event {
            Event::Identity(_) => {
                // Identity events don't write to ingester schema — observing-ingester
                // doesn't process them either. Ack and move on.
            }
            Event::Record(record) => {
                if let Err(e) = process_record(&db, record, &state).await {
                    error!(uri = %format_uri(record), "process_record failed: {}", e);
                    state.write().await.stats.errors += 1;
                    // Skip ack so Tap redelivers after retry-timeout. tapped's
                    // AckGuard is private, so leaking the ReceivedEvent is the
                    // only way to suppress the auto-ack-on-drop.
                    should_ack = false;
                }
            }
            // tapped::Event is #[non_exhaustive]; ignore future variants.
            _ => {}
        }
        if should_ack {
            drop(received);
        } else {
            std::mem::forget(received);
        }
    }

    state.write().await.connected = false;
    warn!("tap channel closed");
    // _process drops here, sending SIGTERM to the embedded Tap.
    Ok(())
}

/// Build a Postgres connection string from either DATABASE_URL directly
/// or the DB_HOST/DB_NAME/DB_USER/DB_PASSWORD bundle observing-ingester
/// uses for Cloud SQL socket connections.
fn resolve_database_url() -> Result<String, Box<dyn std::error::Error>> {
    if let Ok(url) = std::env::var("DATABASE_URL") {
        return Ok(url);
    }
    let host = std::env::var("DB_HOST")
        .map_err(|_| "DATABASE_URL or DB_HOST environment variable is required".to_string())?;
    let name = std::env::var("DB_NAME").unwrap_or_else(|_| "observing".to_string());
    let user = std::env::var("DB_USER").unwrap_or_else(|_| "postgres".to_string());
    let password = std::env::var("DB_PASSWORD").unwrap_or_default();

    if host.starts_with("/cloudsql/") {
        Ok(format!(
            "postgresql://{}:{}@localhost/{}?host={}",
            user, password, name, host
        ))
    } else {
        let port = std::env::var("DB_PORT").unwrap_or_else(|_| "5432".to_string());
        Ok(format!(
            "postgresql://{}:{}@{}:{}/{}",
            user, password, host, port, name
        ))
    }
}

async fn process_record(
    db: &Database,
    record: &RecordEvent,
    state: &SharedState,
) -> Result<(), Box<dyn std::error::Error>> {
    let collection = record.collection.as_str();
    let action = action_to_str(record.action);

    let event_type = match collection {
        OCCURRENCE_COLLECTION => "occurrence",
        IDENTIFICATION_COLLECTION => "identification",
        COMMENT_COLLECTION => "comment",
        INTERACTION_COLLECTION => "interaction",
        LIKE_COLLECTION => "like",
        _ => return Ok(()),
    };

    let uri = format_uri(record);

    let result = if matches!(record.action, RecordAction::Delete) {
        match collection {
            OCCURRENCE_COLLECTION => db.delete_occurrence(&uri).await,
            IDENTIFICATION_COLLECTION => db.delete_identification(&uri).await,
            COMMENT_COLLECTION => db.delete_comment(&uri).await,
            INTERACTION_COLLECTION => db.delete_interaction(&uri).await,
            LIKE_COLLECTION => db.delete_like(&uri).await,
            _ => unreachable!(),
        }
    } else {
        let commit = build_commit(record, &uri)?;

        // Like records are filtered to occurrence-subjects only — same predicate
        // as observing-ingester.
        if collection == LIKE_COLLECTION {
            let is_occurrence_like = commit
                .record
                .as_ref()
                .and_then(|r| r.get("subject"))
                .and_then(|s| s.get("uri"))
                .and_then(|u| u.as_str())
                .is_some_and(|uri| uri.contains(OCCURRENCE_COLLECTION));
            if !is_occurrence_like {
                return Ok(());
            }
        }

        match collection {
            OCCURRENCE_COLLECTION => db.upsert_occurrence(&commit).await,
            IDENTIFICATION_COLLECTION => db.upsert_identification(&commit).await,
            COMMENT_COLLECTION => db.upsert_comment(&commit).await,
            INTERACTION_COLLECTION => db.upsert_interaction(&commit).await,
            LIKE_COLLECTION => db.upsert_like(&commit).await,
            _ => unreachable!(),
        }
    };

    let mut s = state.write().await;
    if let Err(e) = result {
        error!(%uri, error = %e, "{} {} failed", event_type, action);
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
            action: action.to_string(),
            uri,
            time: Utc::now(),
        });
    }
    Ok(())
}

/// Tap delivers events without a per-event timestamp; observing-db's
/// processing module needs *some* time, and falls back to `record.createdAt`
/// when present. Receipt time matches the firehose delivery semantics
/// observing-ingester uses, so we pass that.
fn build_commit(record: &RecordEvent, uri: &str) -> Result<CommitInfo, Box<dyn std::error::Error>> {
    let record_json = match record.record_as_str() {
        Some(s) => Some(serde_json::from_str(s)?),
        None => None,
    };
    Ok(CommitInfo {
        did: record.did.clone(),
        collection: record.collection.clone(),
        rkey: record.rkey.clone(),
        uri: uri.to_string(),
        cid: record.cid.clone().unwrap_or_default(),
        operation: action_to_str(record.action).to_string(),
        seq: 0,
        time: Utc::now(),
        record: record_json,
    })
}

fn format_uri(record: &RecordEvent) -> String {
    format!("at://{}/{}/{}", record.did, record.collection, record.rkey)
}

fn action_to_str(action: RecordAction) -> &'static str {
    match action {
        RecordAction::Create => "create",
        RecordAction::Update => "update",
        RecordAction::Delete => "delete",
        // RecordAction is #[non_exhaustive]; future variants treated as no-op upserts.
        _ => "unknown",
    }
}
