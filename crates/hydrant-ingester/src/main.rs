//! Spike: tap-ingester's write path fed by an embedded hydrant instead of Tap.
//!
//! hydrant (https://hydrant.klbr.net) runs in-process as a library. It reads
//! the relay firehose, discovers repos that publish occurrences (from the
//! firehose and from the relay's `listReposByCollection`), backfills them from
//! their PDSes, and keeps every matching record in a local fjall database with
//! an ordered, replayable event log. This binary reads that log from its own
//! saved cursor and hands each record to the same
//! `tap_ingester::records::process_record` the Tap consumer uses.
//!
//! Not deployable as-is: fjall needs a persistent local disk, which Cloud Run
//! doesn't have. See README.md for how to run it and what's missing.
//!
//! Required env vars (unless DRY_RUN is set):
//!   DATABASE_URL          Postgres connection string, OR
//!   DB_HOST + DB_NAME + DB_USER + DB_PASSWORD   (Cloud SQL socket style)
//!
//! Optional env vars:
//!   DRY_RUN=1             Count records instead of writing them, e.g. to
//!                         measure hydrant beside the production Tap.
//!   PORT                  HTTP server port (default 8080).
//!   HYDRANT_INGESTER_API_BIND
//!                         Where hydrant's own HTTP API (`/stats`, `/repos`,
//!                         `/stream`, ...) listens. Default 127.0.0.1:2480;
//!                         it has no auth, so keep it on loopback. Empty
//!                         disables it.
//!   HYDRANT_*             Any hydrant setting (see its configuration docs).
//!                         The database path, filter, PLC, relay and crawler
//!                         default to observ.ing values rather than hydrant's.
//!
//! HTTP routes:
//!   GET /health            Liveness probe (JSON).
//!   GET /api/stats         Ingester counters, same shape as tap-ingester's.
//!   GET /api/hydrant-stats hydrant's database counts and firehose sources.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{extract::State, routing::get, Json, Router};
use chrono::Utc;
use hydrant::config::{Config, CrawlerMode, CrawlerSource, FirehoseSource};
use hydrant::control::{ApiBinds, Event, Hydrant};
use hydrant::deps::fjall;
use hydrant::deps::futures::StreamExt;
use hydrant::deps::jacquard::types::did::Did;
use miette::{IntoDiagnostic, Result};
use observing_collections::{
    COMMENT_COLLECTION, IDENTIFICATION_COLLECTION, INTERACTION_COLLECTION, LIKE_COLLECTION,
    OCCURRENCE_COLLECTION, REMARK_COLLECTION,
};
use observing_db::failed_records::FailedRecord;
use serde_json::Value;
use tap_ingester::database::Database;
use tap_ingester::lag_probe;
use tap_ingester::records::{self, process_record, Action};
use tap_ingester::server::{ServerState, SharedState};
use tap_ingester::types::RecentEvent;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use tracing_subscriber::{prelude::*, EnvFilter};
use url::Url;

const DEFAULT_DATABASE_PATH: &str = "./.hydrant-ingester/hydrant.db";
/// The relay Tap consumes, so the two can be compared seq for seq.
const DEFAULT_RELAY: &str = "wss://relay1.us-east.bsky.network";
/// hydrant defaults to third-party services for these two (lightrail and
/// plc.wtf); the Bluesky relay lists the same repos Tap tracks.
const DEFAULT_CRAWLER: &str = "https://relay1.us-east.bsky.network";
const DEFAULT_PLC: &str = "https://plc.directory";
const DEFAULT_API_BIND: &str = "127.0.0.1:2480";

const COLLECTIONS: [&str; 6] = [
    OCCURRENCE_COLLECTION,
    IDENTIFICATION_COLLECTION,
    REMARK_COLLECTION,
    COMMENT_COLLECTION,
    INTERACTION_COLLECTION,
    LIKE_COLLECTION,
];

/// How long hydrant gets to flush and close its database on shutdown.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a record waits for the occurrence it points at before it's
/// written to `ingester.failed_records` instead.
const PARK_TIMEOUT: Duration = Duration::from_secs(10 * 60);

fn main() -> Result<()> {
    let env_filter = EnvFilter::from_default_env()
        .add_directive("hydrant_ingester=info".parse().into_diagnostic()?)
        .add_directive("tap_ingester=info".parse().into_diagnostic()?)
        .add_directive("observing_tasks=info".parse().into_diagnostic()?)
        .add_directive("hydrant=info".parse().into_diagnostic()?);
    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_stackdriver::layer())
        .init();

    // hydrant's HTTP clients are rustls and don't pick a crypto provider
    // themselves; its own binary installs this one first thing too.
    hydrant::deps::rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .ok();

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .into_diagnostic()?;
    let hydrant = runtime.block_on(Hydrant::new(hydrant_config()?))?;
    let result = runtime.block_on(run(hydrant.clone()));

    // Dropping the runtime would wait on blocking tasks that only
    // `Hydrant::shutdown` ends, and that needs every other handle gone.
    runtime.shutdown_background();
    info!("stopping, waiting up to {SHUTDOWN_TIMEOUT:?} for hydrant's database to close");
    let closed = hydrant.shutdown(SHUTDOWN_TIMEOUT);
    result?;
    closed?;
    info!("stopped");
    Ok(())
}

async fn run(hydrant: Hydrant) -> Result<()> {
    info!("Starting Observ.ing hydrant-ingester...");

    let dry_run = std::env::var("DRY_RUN").is_ok_and(|v| !v.is_empty() && v != "0");
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8080);

    let state: SharedState = Arc::new(RwLock::new(ServerState::new()));
    let cursor = Arc::new(StreamCursor::open(&hydrant)?);

    let router = Router::new()
        .route("/health", get(health))
        .route("/api/stats", get(api_stats))
        .route("/api/hydrant-stats", get(api_hydrant_stats))
        .with_state(HttpState {
            ingester: state.clone(),
            hydrant: hydrant.clone(),
        });
    tokio::spawn(async move {
        if let Err(e) = observing_bootstrap::serve(router, port).await {
            error!("HTTP server error: {}", e);
        }
    });

    let api_bind =
        std::env::var("HYDRANT_INGESTER_API_BIND").unwrap_or_else(|_| DEFAULT_API_BIND.into());
    if !api_bind.is_empty() {
        let binds = api_bind.parse::<ApiBinds>()?.with_tcp_management(true);
        info!(bind = %api_bind, "serving hydrant's API");
        let hydrant = hydrant.clone();
        tokio::spawn(async move {
            if let Err(e) = hydrant.serve(binds).await {
                error!("hydrant API error: {e}");
            }
        });
    }

    let db = if dry_run {
        warn!("DRY_RUN set: counting records without writing them to Postgres");
        None
    } else {
        let database_url = pg_url_env::database_url_from_env("observing").ok_or_else(|| {
            miette::miette!("DATABASE_URL or DB_HOST environment variable is required")
        })?;
        Some(
            Database::connect(&database_url)
                .await
                .map_err(|e| miette::miette!("{e}"))?,
        )
    };

    let hydrant_run = hydrant.run()?;
    tokio::spawn(heartbeat(hydrant.clone(), state.clone(), cursor.clone()));

    tokio::select! {
        r = hydrant_run => r,
        r = consume(&hydrant, db.as_ref(), &state, &cursor) => r,
        _ = shutdown_signal() => Ok(()),
    }
}

/// hydrant's env config, with observ.ing defaults for whatever isn't set.
fn hydrant_config() -> Result<Config> {
    let unset = |key: &str| std::env::var_os(key).is_none();
    let url = |s: &str| Url::parse(s).expect("default URLs are valid");

    let mut config = Config::from_env()?;
    if unset("HYDRANT_DATABASE_PATH") {
        config.database_path = DEFAULT_DATABASE_PATH.into();
    }
    // Tap is configured to discover repos by occurrences alone, so someone who
    // only identifies or comments on other people's observations is followed
    // only by accident (Tap trusts the relay's stale `listReposByCollection`
    // index; hydrant re-checks it and drops repos with no occurrences left).
    // All six are observ.ing's own namespaces, so signaling on every one
    // only pulls in repos that wrote one of our records.
    if unset("HYDRANT_FILTER_SIGNALS") {
        config.filter_signals = Some(COLLECTIONS.map(String::from).to_vec());
    }
    if unset("HYDRANT_FILTER_COLLECTIONS") {
        config.filter_collections = Some(COLLECTIONS.map(String::from).to_vec());
    }
    if unset("HYDRANT_PLC_URL") {
        config.plc_urls = vec![url(DEFAULT_PLC)];
    }
    if unset("HYDRANT_RELAY_HOSTS") && unset("HYDRANT_RELAY_HOST") {
        config.relays = vec![FirehoseSource {
            url: url(DEFAULT_RELAY),
            is_pds: false,
        }];
    }
    if unset("HYDRANT_CRAWLER_URLS") {
        config.crawler_sources = vec![CrawlerSource {
            url: url(DEFAULT_CRAWLER),
            mode: CrawlerMode::ByCollection,
        }];
    }
    Ok(config)
}

async fn shutdown_signal() {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("installing a SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
    info!("got a stop signal, stopping");
}

/// Our position in hydrant's event stream: the id of the next event to read.
///
/// Kept in hydrant's own database rather than Postgres, because event ids only
/// mean something to the database that issued them — wiping hydrant's
/// database has to reset this too.
struct StreamCursor {
    keyspace: fjall::Keyspace,
    next: AtomicU64,
}

impl StreamCursor {
    const KEY: &'static [u8] = b"next_event_id";

    fn open(hydrant: &Hydrant) -> Result<Self> {
        let keyspace = hydrant
            .db
            .open_keyspace("observing", fjall::KeyspaceCreateOptions::default)?;
        let next = match keyspace.get(Self::KEY).into_diagnostic()? {
            Some(bytes) => u64::from_be_bytes(
                bytes
                    .as_ref()
                    .try_into()
                    .map_err(|_| miette::miette!("stream cursor isn't 8 bytes"))?,
            ),
            None => 0,
        };
        Ok(Self {
            keyspace,
            next: AtomicU64::new(next),
        })
    }

    fn next(&self) -> u64 {
        self.next.load(Ordering::Relaxed)
    }

    /// Record that the event with this id is done. Not synced to disk on
    /// every call, so a crash replays the last few events; every write is an
    /// idempotent upsert or delete, so that's harmless.
    fn advance_past(&self, id: u64) -> Result<()> {
        let next = id + 1;
        self.keyspace
            .insert(Self::KEY, &next.to_be_bytes()[..])
            .into_diagnostic()?;
        self.next.store(next, Ordering::Relaxed);
        Ok(())
    }
}

/// Read hydrant's event log from our cursor forever, resubscribing whenever
/// the stream ends (we fell too far behind, or a database read failed).
async fn consume(
    hydrant: &Hydrant,
    db: Option<&Database>,
    state: &SharedState,
    cursor: &StreamCursor,
) -> Result<()> {
    let mut parked = Parked::default();
    let mut expire_parked = tokio::time::interval(Duration::from_secs(60));
    loop {
        let from = cursor.next();
        info!(from, "subscribing to hydrant's event stream");
        let mut stream = hydrant.subscribe(Some(from));
        state.write().await.connected = true;
        loop {
            tokio::select! {
                item = stream.next() => match item {
                    Some(Ok(event)) => {
                        let id = event.id;
                        handle_event(hydrant, db, state, &mut parked, event).await;
                        cursor.advance_past(id)?;
                    }
                    Some(Err(e)) => {
                        warn!(error = %e, "hydrant stream error, resubscribing");
                        break;
                    }
                    None => {
                        warn!("hydrant stream ended, resubscribing");
                        break;
                    }
                },
                _ = expire_parked.tick() => {
                    if let Some(db) = db {
                        parked.expire(db).await;
                    }
                }
            }
        }
        state.write().await.connected = false;
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

async fn handle_event(
    hydrant: &Hydrant,
    db: Option<&Database>,
    state: &SharedState,
    parked: &mut Parked,
    event: Event,
) {
    // Identity and account events: the Tap consumer ignores these too.
    let Some(rec) = event.record else {
        return;
    };
    let action = match rec.action.as_ref() {
        "create" => Action::Create,
        "update" => Action::Update,
        "delete" => Action::Delete,
        other => {
            warn!(action = other, "unknown record action, skipping");
            return;
        }
    };
    let value: Option<Value> = rec
        .record
        .as_ref()
        .and_then(|raw| serde_json::from_str(raw.get()).ok());
    let cid = rec.cid.map(|c| c.to_string());
    let record = records::Record {
        did: rec.did.as_str(),
        collection: rec.collection.as_str(),
        rkey: rec.rkey.as_str(),
        action,
        cid: cid.as_deref(),
        value: value.as_ref(),
    };

    let Some(db) = db else {
        count_only(state, &record).await;
        return;
    };

    match process_record(db, &record, state).await {
        Ok(()) => {
            if record.collection == OCCURRENCE_COLLECTION && action != Action::Delete {
                parked.release(&record.uri(), db, state).await;
            }
        }
        Err(err) => {
            // The occurrence this points at isn't in Postgres yet: it's on a
            // repo hydrant hasn't backfilled, or later in this repo's own
            // backfill (identifications sort before occurrences in the MST).
            // Tap covers this by withholding the ack so it redelivers later;
            // hydrant's stream has no acks, so hold the record until the
            // occurrence lands.
            let subject = value.as_ref().and_then(records::subject_uri);
            if let (true, Some(subject)) = (err.is_missing_subject(), subject) {
                track_subject_repo(hydrant, subject).await;
                parked.park(subject, &record, err.to_string());
            } else {
                record_failure(db, &record, &err.to_string()).await;
            }
        }
    }
}

/// Make sure hydrant follows the repo a record's subject lives in. A no-op
/// when it already does.
async fn track_subject_repo(hydrant: &Hydrant, subject_uri: &str) {
    let Some(did) = subject_uri
        .strip_prefix("at://")
        .and_then(|rest| rest.split('/').next())
        .and_then(|did| Did::new_owned(did).ok())
    else {
        return;
    };
    match hydrant.repos.track([did.clone()]).await {
        Ok(queued) if !queued.is_empty() => {
            info!(did = %did.as_str(), "started tracking subject repo")
        }
        Ok(_) => {}
        Err(e) => warn!(did = %did.as_str(), error = %e, "tracking subject repo failed"),
    }
}

async fn record_failure(db: &Database, record: &records::Record<'_>, error: &str) {
    let uri = record.uri();
    if let Err(e) = db
        .record_failure(FailedRecord {
            uri: &uri,
            collection: record.collection,
            did: record.did,
            cid: record.cid,
            action: record.action.as_str(),
            record_json: record.value,
            error,
        })
        .await
    {
        warn!(%uri, error = %e, "failed_records ledger write failed");
    }
}

/// DRY_RUN's stand-in for `process_record`: the same counters, no writes.
async fn count_only(state: &SharedState, record: &records::Record<'_>) {
    let mut s = state.write().await;
    let event_type = match record.collection {
        OCCURRENCE_COLLECTION => {
            s.stats.occurrences += 1;
            "occurrence"
        }
        IDENTIFICATION_COLLECTION => {
            s.stats.identifications += 1;
            "identification"
        }
        REMARK_COLLECTION => {
            s.stats.remarks += 1;
            "remark"
        }
        COMMENT_COLLECTION => {
            s.stats.comments += 1;
            "comment"
        }
        INTERACTION_COLLECTION => {
            s.stats.interactions += 1;
            "interaction"
        }
        LIKE_COLLECTION => {
            s.stats.likes += 1;
            "like"
        }
        _ => return,
    };
    s.add_recent_event(RecentEvent {
        event_type: event_type.to_string(),
        action: record.action.as_str().to_string(),
        uri: record.uri(),
        time: Utc::now(),
    });
}

/// Records waiting on the occurrence they point at, keyed by its URI.
///
/// In memory only: after a restart our cursor is already past them, so a
/// record still parked when the process stops is lost (hydrant still has
/// it, so a replay from an earlier cursor would recover it).
#[derive(Default)]
struct Parked {
    by_subject: HashMap<String, Vec<ParkedRecord>>,
}

struct ParkedRecord {
    did: String,
    collection: String,
    rkey: String,
    action: Action,
    cid: Option<String>,
    value: Option<Value>,
    error: String,
    parked_at: Instant,
}

impl ParkedRecord {
    fn as_record(&self) -> records::Record<'_> {
        records::Record {
            did: &self.did,
            collection: &self.collection,
            rkey: &self.rkey,
            action: self.action,
            cid: self.cid.as_deref(),
            value: self.value.as_ref(),
        }
    }
}

impl Parked {
    fn park(&mut self, subject_uri: &str, record: &records::Record<'_>, error: String) {
        info!(uri = %record.uri(), subject = subject_uri, "parking record until its subject lands");
        self.by_subject
            .entry(subject_uri.to_string())
            .or_default()
            .push(ParkedRecord {
                did: record.did.to_string(),
                collection: record.collection.to_string(),
                rkey: record.rkey.to_string(),
                action: record.action,
                cid: record.cid.map(str::to_string),
                value: record.value.cloned(),
                error,
                parked_at: Instant::now(),
            });
    }

    /// Retry everything waiting on this occurrence, now that it's written.
    async fn release(&mut self, subject_uri: &str, db: &Database, state: &SharedState) {
        let Some(waiting) = self.by_subject.remove(subject_uri) else {
            return;
        };
        for parked in waiting {
            let record = parked.as_record();
            match process_record(db, &record, state).await {
                Ok(()) => info!(uri = %record.uri(), "parked record ingested"),
                Err(e) => record_failure(db, &record, &e.to_string()).await,
            }
        }
    }

    /// Give up on records whose subject never arrived.
    async fn expire(&mut self, db: &Database) {
        let mut expired = Vec::new();
        self.by_subject.retain(|_, waiting| {
            let (old, fresh) = std::mem::take(waiting)
                .into_iter()
                .partition(|p| p.parked_at.elapsed() >= PARK_TIMEOUT);
            expired.extend::<Vec<_>>(old);
            *waiting = fresh;
            !waiting.is_empty()
        });
        for parked in expired {
            record_failure(db, &parked.as_record(), &parked.error).await;
        }
    }
}

/// Emit a structured heartbeat log every 60s, per relay. Mirrors
/// tap-ingester's so the same log-based metrics chart both: `cursor_advance`
/// (relay seqs read since the last tick, i.e. firehose throughput) and
/// `lag_seconds` (how far behind the live firehose that seq is, `-1` when the
/// probe failed).
///
/// hydrant-only fields: `repos`/`records`/`backfill_pending` from its
/// database, and `stream_head` vs `consumer_cursor` for how far this
/// process's Postgres writes trail hydrant's own log.
async fn heartbeat(hydrant: Hydrant, state: SharedState, cursor: Arc<StreamCursor>) {
    let mut ticker = tokio::time::interval(Duration::from_secs(60));
    let mut prev_seqs: HashMap<Url, i64> = HashMap::new();
    loop {
        ticker.tick().await;
        let (connected, events_total, errors) = {
            let s = state.read().await;
            let st = &s.stats;
            (
                s.connected,
                st.occurrences
                    + st.identifications
                    + st.remarks
                    + st.comments
                    + st.interactions
                    + st.likes,
                st.errors,
            )
        };
        let counts = hydrant.stats().await.map(|s| s.counts).unwrap_or_default();
        let count = |key: &str| counts.get(key).copied().unwrap_or(0);
        let stream_head = hydrant.stream_head().ok().flatten();

        for source in hydrant.firehose.list_sources().await {
            let seq = source.stats.as_ref().and_then(|s| s.last_seq);
            let cursor_advance = match (prev_seqs.get(&source.url), seq) {
                (Some(&prev), Some(cur)) if cur >= prev => cur - prev,
                _ => -1,
            };
            if let Some(cur) = seq {
                prev_seqs.insert(source.url.clone(), cur);
            }
            let lag_seconds = match seq {
                Some(cur) => match lag_probe::probe_cursor_time(source.url.as_str(), cur).await {
                    Some(at_cursor) => (Utc::now() - at_cursor).num_seconds(),
                    None => -1,
                },
                None => -1,
            };

            info!(
                heartbeat = true,
                relay = %source.url,
                connected,
                events_total,
                errors,
                firehose_cursor = seq.unwrap_or(-1),
                cursor_advance,
                lag_seconds,
                repos = count("repos"),
                records = count("records"),
                backfill_pending = count("pending"),
                stream_head = stream_head.map_or(-1, |h| h as i64),
                consumer_cursor = cursor.next(),
                "ingester heartbeat"
            );
        }
    }
}

#[derive(Clone)]
struct HttpState {
    ingester: SharedState,
    hydrant: Hydrant,
}

async fn health(State(s): State<HttpState>) -> Json<Value> {
    let connected = s.ingester.read().await.connected;
    Json(serde_json::json!({ "status": "ok", "connected": connected }))
}

async fn api_stats(State(s): State<HttpState>) -> Json<Value> {
    let ig = s.ingester.read().await;
    Json(serde_json::json!({
        "connected": ig.connected,
        "uptime": (Utc::now() - ig.started_at).num_seconds(),
        "stats": ig.stats,
        "recentEvents": ig.recent_events,
    }))
}

async fn api_hydrant_stats(State(s): State<HttpState>) -> Json<Value> {
    let stats = s.hydrant.stats().await.ok();
    let sources = s.hydrant.firehose.list_sources().await;
    Json(serde_json::json!({
        "counts": stats.as_ref().map(|s| &s.counts),
        "sizes": stats.as_ref().map(|s| &s.sizes),
        "streamHead": s.hydrant.stream_head().ok().flatten(),
        "firehoseSources": sources,
    }))
}
