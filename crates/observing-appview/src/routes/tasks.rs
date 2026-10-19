//! Routes Cloud Tasks calls, one per [`Task`], mounted only with
//! `APPVIEW_TASK_ROUTES` on.
//!
//! In production that's `observing-worker`: this image deployed a second
//! time, privately (`--no-allow-unauthenticated`, so Cloud Run checks the
//! caller's token) and as one instance, so per-process limits are global.
//! Each task's queue runs one request at a time, and each handler holds a
//! lock for the same locally. In local development the dev appview serves
//! these routes itself, and `observing_tasks` POSTs to it directly.

use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use observing_resolve_taxa::pass::{Clients, Cursor, Options, Outcome};
use observing_tasks::{Run, Task};
use observing_taxonomy_gbif::GbifUpstream;
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tracing::{error, info};
use wikidata_client::WikidataClient;

use crate::state::AppState;

/// How long one resolution pass runs before handing the rest to a new run.
/// Leaves [`Task::dispatch_deadline`] room for the item in progress and the
/// matview refresh.
const RESOLVE_TAXA_BUDGET: Duration = Duration::from_secs(10 * 60);

/// Pause between GBIF lookups, to be polite.
const GBIF_RATE_LIMIT: Duration = Duration::from_millis(100);

/// One run of each task at a time in this process. The task's queue already
/// ensures this in production; locally, it keeps overlapping runs from
/// multiplying the rate GBIF sees.
static RESOLVING_TAXA: Mutex<()> = Mutex::const_new(());

pub fn router() -> Router<AppState> {
    Router::new().route(Task::ResolveTaxa.path(), post(resolve_taxa))
}

/// Run a resolution pass, from the [`Cursor`] in the body or from the start,
/// and queue a run to carry on if the budget runs out first. A 5xx has Cloud
/// Tasks retry the request.
async fn resolve_taxa(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, String)> {
    let Some(pool) = state.ingester_pool.clone() else {
        // A 5xx, so the run isn't lost while the worker is misconfigured.
        error!("Resolution pass requested, but there's no ingester database connection");
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "no ingester database connection".to_string(),
        ));
    };
    let from: Cursor = if body.is_empty() {
        Cursor::default()
    } else {
        serde_json::from_slice(&body)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid cursor: {e}")))?
    };

    let _running = RESOLVING_TAXA.lock().await;
    info!(from = ?from, "Starting resolution pass");
    let clients = Clients {
        pool,
        gbif: GbifUpstream::default(),
        wikidata: WikidataClient::new(),
    };
    let opts = Options {
        rate_limit: GBIF_RATE_LIMIT,
        limit: None,
        dry_run: false,
        deadline: state
            .tasks
            .is_cloud_tasks()
            .then(|| Instant::now() + RESOLVE_TAXA_BUDGET),
    };
    let report = clients.run_pass(from, &opts).await.map_err(|e| {
        error!(error = %e, "Resolution pass failed");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    let paused = match report.outcome {
        Outcome::Paused(next) => {
            let run = Run {
                body: Some(serde_json::to_value(&next).expect("a cursor serializes")),
                ..Default::default()
            };
            state
                .tasks
                .enqueue(Task::ResolveTaxa, run)
                .await
                .map_err(|e| {
                    // The rerun only repeats the lookups that found nothing:
                    // the keys this one set stay set.
                    error!(error = %e, "Failed to queue the rest of the pass");
                    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                })?;
            info!(next = ?next, "Queued the rest of the pass");
            true
        }
        Outcome::Complete => false,
    };
    info!(
        updated_rows = report.updated_rows,
        paused, "Resolution pass finished"
    );
    Ok(Json(json!({
        "updated_rows": report.updated_rows,
        "paused": paused,
    })))
}
