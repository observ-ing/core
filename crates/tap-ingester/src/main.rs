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
//! Required env vars (one of):
//!   DATABASE_URL          Postgres connection string, OR
//!   DB_HOST + DB_NAME + DB_USER + DB_PASSWORD   (Cloud SQL socket style)
//!
//! Optional env vars:
//!   TAP_URL               If set, skip spawning Tap and connect to this URL.
//!   TAP_ADMIN_PASSWORD    Basic auth password (passed to spawned Tap or used
//!                         when connecting to an existing one).
//!   TAP_DATABASE_URL      Backing DB for the embedded Tap. If unset and
//!                         DB_HOST is set (production), tap-ingester
//!                         derives a Postgres URL from the same DB_*
//!                         vars used for the app database, with
//!                         `search_path=tap` so Tap's tables land in
//!                         their own schema. If neither is set,
//!                         falls back to `sqlite:///data/tap.db`
//!                         (instance-ephemeral on Cloud Run).
//!   PORT                  HTTP server port (default 8080).
//!
//! HTTP routes (see `dashboard` module for handlers):
//!   GET /                  Combined ingester + Tap status page.
//!   GET /health            Cloud Run liveness probe (JSON).
//!   GET /api/stats         Ingester counters (JSON).
//!   GET /api/tap-stats     Tap-side counts, buffers, cursors (JSON).

mod dashboard;
mod database;
mod error;
mod media_resolver;
mod server;
mod subject_resolver;
mod types;

use std::sync::Arc;

use chrono::Utc;
use clap::Parser;
use dashboard::DashboardState;
use database::Database;
use serde_json::Value;
use server::{ServerState, SharedState};
use subject_resolver::SubjectResolver;
use tapped::{Event, LogLevel, RecordAction, RecordEvent, TapClient, TapConfig, TapProcess};
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use tracing_subscriber::{prelude::*, EnvFilter};
use types::{
    RecentEvent, COMMENT_COLLECTION, IDENTIFICATION_COLLECTION, INTERACTION_COLLECTION,
    LIKE_COLLECTION, OCCURRENCE_COLLECTION,
};

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

    // Tap-side state for the dashboard. Initially empty; `OnceCell::set`
    // lands once Tap has been spawned/connected below. The HTTP server
    // can run before that — `/api/tap-stats` reports "not yet initialized"
    // until the cell is populated.
    let tap_cell: Arc<tokio::sync::OnceCell<TapClient>> = Arc::new(tokio::sync::OnceCell::new());

    // Spawn HTTP server immediately so Cloud Run TCP startup probe passes.
    let dash_state = DashboardState {
        ingester: state.clone(),
        tap: tap_cell.clone(),
    };
    tokio::spawn(async move {
        if let Err(e) = serve_http(dash_state, port).await {
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
                .database_url(resolve_tap_database_url())
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
            // tapped defaults Tap's stdio to /dev/null. In CI we want
            // Tap's startup logs visible so failures are debuggable.
            if std::env::var("TAP_INHERIT_STDIO").is_ok() {
                builder = builder.inherit_stdio(true);
            }
            let process = TapProcess::spawn_default(builder.build()).await?;
            let client = process.client()?;
            (Some(process), client)
        }
    };

    // Make the TapClient visible to the dashboard's `/api/tap-stats`
    // endpoint. `set` returns Err if already set; that can't happen here
    // (we run this once), so .ok() the result.
    tap_cell.set(tap.clone()).ok();

    // Resolver for cross-repo subject DIDs: when an identification/comment/
    // like references an occurrence on a DID Tap isn't tracking, the
    // resolver POSTs `/repos/add` and we suppress the ack so Tap redelivers
    // the record after backfill. De-dupes per-process so we don't
    // hammer `/repos/add` for the same DID.
    let subject_resolver = SubjectResolver::new(tap.clone());

    info!("connecting to tap channel");
    let mut channel = tap.channel().await?;
    state.write().await.connected = true;
    info!("tap channel connected");

    while let Ok(received) = channel.recv().await {
        let mut should_ack = true;
        if let Event::Record(record) = &received.event {
            if process_record(&db, record, &state).await.is_err() {
                // process_record already logged + bumped stats.errors.
                // Reactively ask the resolver for the subject DID; if it
                // *added* a new DID to Tap, suppress this event's ack so
                // Tap redelivers after the foreign repo backfills.
                // Otherwise (subject already tracked, no subject, or
                // resolver couldn't add), ack and move on — looping on
                // unresolvable records would saturate the queue.
                let added_new_did = match record_json(record) {
                    Some(json) => subject_resolver
                        .ensure_subject_tracked(&json)
                        .await
                        .is_some(),
                    None => false,
                };
                if added_new_did {
                    should_ack = false;
                }
            }
        }
        // Identity events and any future #[non_exhaustive] tapped::Event
        // variants ack via Drop without further handling.
        if should_ack {
            drop(received);
        } else {
            // Skip auto-ack so Tap redelivers after retry-timeout. tapped's
            // AckGuard is private, so leaking the ReceivedEvent is the only
            // way to suppress the auto-ack-on-drop.
            std::mem::forget(received);
        }
    }

    state.write().await.connected = false;
    warn!("tap channel closed");
    // _process drops here, sending SIGTERM to the embedded Tap.
    Ok(())
}

async fn serve_http(state: DashboardState, port: u16) -> std::io::Result<()> {
    let router = dashboard::router(state);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    info!("Starting HTTP server on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await
}

/// Backing DB URL for the embedded Tap.
///
/// Precedence:
/// 1. `TAP_DATABASE_URL` if set — explicit override (e.g. local dev
///    pointing at a separate sqlite file).
/// 2. `DB_HOST` set → derive a Postgres URL from the same env vars
///    `resolve_database_url` uses for the app DB, plus
///    `options=-c search_path=tap` so Tap's tables land in the `tap`
///    schema instead of `public`. This is the production path.
/// 3. Fallback `sqlite:///data/tap.db` — instance-ephemeral, only
///    relevant when nothing about Postgres is configured (early local
///    dev with just `DATABASE_URL`).
fn resolve_tap_database_url() -> String {
    if let Ok(url) = std::env::var("TAP_DATABASE_URL") {
        return url;
    }
    let Ok(host) = std::env::var("DB_HOST") else {
        return "sqlite:///data/tap.db".to_string();
    };
    let name = std::env::var("DB_NAME").unwrap_or_else(|_| "observing".to_string());
    let user = std::env::var("DB_USER").unwrap_or_else(|_| "postgres".to_string());
    let password = std::env::var("DB_PASSWORD").unwrap_or_default();
    if host.starts_with("/cloudsql/") {
        format!(
            "postgresql://{user}:{password}@localhost/{name}?host={host}&options=-c%20search_path%3Dtap"
        )
    } else {
        let port = std::env::var("DB_PORT").unwrap_or_else(|_| "5432".to_string());
        format!(
            "postgresql://{user}:{password}@{host}:{port}/{name}?options=-c%20search_path%3Dtap"
        )
    }
}

/// Build a Postgres connection string from either DATABASE_URL directly
/// or the DB_HOST/DB_NAME/DB_USER/DB_PASSWORD bundle the existing
/// services use for Cloud SQL socket connections.
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
        let Some(record_value) = record_json(record) else {
            warn!(%uri, "record event without parseable JSON; skipping");
            return Ok(());
        };
        let cid = record.cid.as_deref().unwrap_or("");
        let now = Utc::now();

        // Like records are filtered to occurrence-subjects only.
        if collection == LIKE_COLLECTION && !subject_uri_is_occurrence(&record_value) {
            return Ok(());
        }

        match collection {
            OCCURRENCE_COLLECTION => {
                db.upsert_occurrence(&record.did, &uri, cid, now, &record_value)
                    .await
            }
            IDENTIFICATION_COLLECTION => {
                db.upsert_identification(&record.did, &uri, cid, now, &record_value)
                    .await
            }
            COMMENT_COLLECTION => {
                db.upsert_comment(&record.did, &uri, cid, now, &record_value)
                    .await
            }
            INTERACTION_COLLECTION => {
                db.upsert_interaction(&record.did, &uri, cid, now, &record_value)
                    .await
            }
            LIKE_COLLECTION => {
                db.upsert_like(&record.did, &uri, cid, now, &record_value)
                    .await
            }
            _ => unreachable!(),
        }
    };

    let mut s = state.write().await;
    if let Err(e) = result {
        error!(%uri, error = %e, "{} {} failed", event_type, action);
        s.stats.errors += 1;
        Err(e.into())
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
        Ok(())
    }
}

fn subject_uri_is_occurrence(record: &Value) -> bool {
    record
        .get("subject")
        .and_then(|s| s.get("uri"))
        .and_then(|u| u.as_str())
        .is_some_and(|uri| uri.contains(OCCURRENCE_COLLECTION))
}

fn format_uri(record: &RecordEvent) -> String {
    format!("at://{}/{}/{}", record.did, record.collection, record.rkey)
}

fn record_json(record: &RecordEvent) -> Option<Value> {
    record
        .record_as_str()
        .and_then(|s| serde_json::from_str(s).ok())
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
