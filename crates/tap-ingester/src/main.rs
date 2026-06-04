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
mod lag_probe;
mod media_resolver;
mod server;
mod subject_resolver;
mod types;

use std::sync::Arc;

use chrono::Utc;
use clap::Parser;
use dashboard::DashboardState;
use database::Database;
use observing_collections::{
    COMMENT_COLLECTION, IDENTIFICATION_COLLECTION, INTERACTION_COLLECTION, LIKE_COLLECTION,
    OCCURRENCE_COLLECTION,
};
use observing_db::failed_records::FailedRecord;
use serde_json::Value;
use server::{ServerState, SharedState};
use subject_resolver::SubjectResolver;
use tapped::{Event, LogLevel, RecordAction, RecordEvent, TapClient, TapConfig, TapProcess};
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use tracing_subscriber::{prelude::*, EnvFilter};
use types::RecentEvent;

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

    // Same late-init pattern for the DB pool: HTTP server up first so
    // Cloud Run TCP startup probe passes, then `Database::connect` below
    // sets this cell so `/api/failed-records` can query the ledger.
    let pool_cell: Arc<tokio::sync::OnceCell<sqlx::postgres::PgPool>> =
        Arc::new(tokio::sync::OnceCell::new());

    // Spawn HTTP server immediately so Cloud Run TCP startup probe passes.
    let dash_state = DashboardState {
        ingester: state.clone(),
        tap: tap_cell.clone(),
        pool: pool_cell.clone(),
    };
    tokio::spawn(async move {
        if let Err(e) = serve_http(dash_state, port).await {
            error!("HTTP server error: {}", e);
        }
    });

    let db = Database::connect(&database_url).await?;
    pool_cell.set(db.pool().clone()).ok();

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

    // Periodic heartbeat so Cloud Logging has a steady signal to build
    // log-based metrics on (cursor progression = liveness; a flat cursor
    // or growing resync buffer = stall). Without this, logs are purely
    // event-driven and there's nothing to graph between reconnects.
    tokio::spawn(heartbeat(
        state.clone(),
        tap.clone(),
        resolve_lag_probe_relay(),
    ));

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
            if let Err(err) = process_record(&db, record, &state).await {
                // process_record already logged + bumped stats.errors.
                // Reactively ask the resolver for the subject DID; if it
                // *added* a new DID to Tap, suppress this event's ack so
                // Tap redelivers after the foreign repo backfills.
                // Otherwise (subject already tracked, no subject, or
                // resolver couldn't add), record the drop in
                // `ingester.failed_records` so the loss is observable
                // and a future replay job can re-attempt — then ack and
                // move on. Looping on unresolvable records would
                // saturate the queue.
                let json = record_json(record);
                let added_new_did = match json.as_ref() {
                    Some(j) => subject_resolver.ensure_subject_tracked(j).await.is_some(),
                    None => false,
                };
                if added_new_did {
                    should_ack = false;
                } else {
                    let uri = format_uri(record);
                    let err_str = err.to_string();
                    if let Err(ledger_err) = db
                        .record_failure(FailedRecord {
                            uri: &uri,
                            collection: record.collection.as_str(),
                            did: &record.did,
                            cid: record.cid.as_deref(),
                            action: action_to_str(record.action),
                            record_json: json.as_ref(),
                            error: &err_str,
                        })
                        .await
                    {
                        warn!(%uri, error = %ledger_err, "failed_records ledger write failed");
                    }
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

/// Emit a structured heartbeat log every 60s. `tracing_stackdriver`
/// renders each field into `jsonPayload.*`, so a log-based metric can
/// chart ingester health over time.
///
/// Key fields:
/// - `cursor_advance`: firehose cursor delta since the previous tick. The
///   absolute cursor is a ~3e10 sequence number that no distribution metric
///   can chart usefully; the per-tick *delta* is a small, chartable number
///   that IS the lag signal — a flat-zero advance while `connected` means a
///   stall, sustained-low means falling behind the live firehose.
/// - `outbox_buffer`: matched records buffered for delivery to the ingester;
///   a rising value is the most direct "can't keep up" signal.
/// - `resync_buffer`: backfill queue depth (should stay near zero).
/// - `firehose_cursor`: still logged (raw seq) for reference / probing.
/// - `lag_seconds`: wall-clock seconds behind the live firehose, from probing
///   the relay for the commit time at the current cursor. `-1` when there's no
///   cursor yet or the probe failed/timed out this tick. This is the absolute
///   "how far behind" signal `cursor_advance` can't give: it plateaus near the
///   relay's ~72h retention floor when stalled and trends to zero when caught
///   up. (Stackdriver camelCases it to `lagSeconds`.)
///
/// `relay_url` must be the relay Tap consumes from; an empty string disables
/// the probe (sentinel `-1`), e.g. where outbound firehose access is blocked.
async fn heartbeat(state: SharedState, tap: TapClient, relay_url: String) {
    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(60));
    // Previous firehose cursor, for computing per-tick advancement.
    let mut prev_cursor: Option<i64> = None;
    loop {
        ticker.tick().await;
        let (connected, events_total, errors) = {
            let s = state.read().await;
            let st = &s.stats;
            (
                s.connected,
                st.occurrences + st.identifications + st.comments + st.interactions + st.likes,
                st.errors,
            )
        };
        let firehose_cursor = tap.cursors().await.ok().and_then(|c| c.firehose);
        let resync_buffer = tap.resync_buffer().await.ok();
        let outbox_buffer = tap.outbox_buffer().await.ok();

        // Advancement since last tick. Skip (sentinel -1) on the first tick
        // and across a cursor reset/restart (current < prev, or a 0/unknown
        // cursor) so a restart doesn't masquerade as negative throughput.
        let cursor_advance = match (prev_cursor, firehose_cursor) {
            (Some(prev), Some(cur)) if cur >= prev && prev > 0 => cur - prev,
            _ => -1,
        };
        if let Some(cur) = firehose_cursor {
            if cur > 0 {
                prev_cursor = Some(cur);
            }
        }

        // Absolute lag: probe the relay for the commit time at the current
        // cursor and subtract from now. Skipped (sentinel -1) when the probe is
        // disabled, there's no usable cursor, or the relay didn't answer.
        let lag_seconds = match (relay_url.is_empty(), firehose_cursor) {
            (false, Some(cur)) if cur > 0 => {
                match lag_probe::probe_cursor_time(&relay_url, cur).await {
                    Some(at_cursor) => (Utc::now() - at_cursor).num_seconds(),
                    None => -1,
                }
            }
            _ => -1,
        };

        info!(
            heartbeat = true,
            connected,
            events_total,
            errors,
            // -1 / 0 sentinels keep fields numeric for log-based metrics even
            // when a Tap query failed this tick (or on the first/reset tick
            // for cursor_advance).
            firehose_cursor = firehose_cursor.unwrap_or(-1),
            cursor_advance,
            outbox_buffer = outbox_buffer.unwrap_or(0),
            resync_buffer = resync_buffer.unwrap_or(0),
            lag_seconds,
            "ingester heartbeat"
        );
    }
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
    // Same DB_* bundle as the app DB, but pin Tap's tables to the `tap` schema.
    pg_url_env::postgres_url_from_db_env("observing", Some("tap"))
        .unwrap_or_else(|| "sqlite:///data/tap.db".to_string())
}

/// Relay the heartbeat's lag probe connects to. Must match the relay Tap
/// consumes from (sequence numbers are relay-specific) — Tap is left on its
/// default `relay1.us-east.bsky.network`, so this default matches. Override
/// with `LAG_PROBE_RELAY_URL`; set it empty to disable the probe.
fn resolve_lag_probe_relay() -> String {
    std::env::var("LAG_PROBE_RELAY_URL")
        .unwrap_or_else(|_| "wss://relay1.us-east.bsky.network".to_string())
}

/// Build a Postgres connection string from either DATABASE_URL directly
/// or the DB_HOST/DB_NAME/DB_USER/DB_PASSWORD bundle the existing
/// services use for Cloud SQL socket connections.
fn resolve_database_url() -> Result<String, Box<dyn std::error::Error>> {
    pg_url_env::database_url_from_env("observing")
        .ok_or_else(|| "DATABASE_URL or DB_HOST environment variable is required".into())
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
