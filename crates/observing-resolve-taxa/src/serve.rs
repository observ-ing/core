//! `--serve`: run a walk on each `POST /run`.
//!
//! In production this is a private Cloud Run service that Cloud Tasks calls
//! (see `infra/README.md#observing-resolve-taxa`). tap-ingester queues a task
//! for the minute after it writes an unresolved identification, and an hourly
//! Cloud Scheduler job calls in case a task was lost. The service scales to
//! zero in between, so it costs nothing while idle.
//!
//! A `POST /run` with an empty body starts a walk from the beginning; one
//! with a [`Cursor`] carries on from it. With a queue configured, each
//! request stops after [`WALK_BUDGET`] and queues a task to carry on, so no
//! request runs into Cloud Tasks' dispatch deadline. Without one (local
//! development), a request walks to the end.

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use gcp_cloud_tasks::{HttpTask, Queue};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tracing::{error, info};

use crate::pass::{Clients, Cursor, Options, Outcome};

/// How long one request walks before handing the rest to a new task.
const WALK_BUDGET: Duration = Duration::from_secs(10 * 60);

/// How long Cloud Tasks waits on a continuation. Covers the budget, the item
/// in progress when it runs out, and the matview refresh.
const DISPATCH_DEADLINE: Duration = Duration::from_secs(15 * 60);

pub struct Server {
    pub clients: Clients,
    pub rate_limit: Duration,
    /// Where continuations go. `None` walks each request to the end.
    pub queue: Option<Queue>,
    /// One walk at a time in this process. Cloud Run's `--concurrency=1`
    /// already ensures this in production.
    walking: Mutex<()>,
}

impl Server {
    pub fn new(clients: Clients, rate_limit: Duration, queue: Option<Queue>) -> Self {
        Self {
            clients,
            rate_limit,
            queue,
            walking: Mutex::new(()),
        }
    }
}

pub fn router(server: Arc<Server>) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/run", post(run))
        .with_state(server)
}

async fn run(
    State(server): State<Arc<Server>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, String)> {
    let from: Cursor = if body.is_empty() {
        Cursor::default()
    } else {
        serde_json::from_slice(&body)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid cursor: {e}")))?
    };

    let _walking = server.walking.lock().await;
    info!(from = ?from, "Starting resolution walk");
    let opts = Options {
        rate_limit: server.rate_limit,
        limit: None,
        dry_run: false,
        deadline: server.queue.as_ref().map(|_| Instant::now() + WALK_BUDGET),
    };
    let report = server.clients.walk(from, &opts).await.map_err(|e| {
        // A 5xx has Cloud Tasks retry the request with backoff.
        error!(error = %e, "Resolution walk failed");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    let paused = match (report.outcome, &server.queue) {
        (Outcome::Paused(next), Some(queue)) => {
            continue_later(queue, &headers, &next).await?;
            true
        }
        // Without a deadline a walk can't pause.
        (Outcome::Paused(_), None) | (Outcome::Complete, _) => false,
    };
    info!(
        updated_rows = report.updated_rows,
        paused, "Resolution walk finished"
    );
    Ok(Json(json!({
        "updated_rows": report.updated_rows,
        "paused": paused,
    })))
}

/// Queue a task that carries on from `next`, addressed to this service.
async fn continue_later(
    queue: &Queue,
    headers: &HeaderMap,
    next: &Cursor,
) -> Result<(), (StatusCode, String)> {
    // Cloud Run doesn't tell a service its own URL, but every request to it
    // arrives at that host.
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "no Host header to address a continuation to".to_string(),
            )
        })?;
    let service_url = format!("https://{host}");
    let task = HttpTask {
        id: None,
        url: format!("{service_url}/run"),
        audience: service_url,
        body: Some(serde_json::to_value(next).expect("a cursor serializes")),
        schedule_time: None,
        dispatch_deadline: Some(DISPATCH_DEADLINE),
    };
    queue.create(&task).await.map_err(|e| {
        // The 5xx has Cloud Tasks rerun this request. The keys it set stay
        // set, so the rerun only repeats the lookups that found nothing.
        error!(error = %e, "Failed to queue the rest of the walk");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;
    info!(next = ?next, "Queued the rest of the walk");
    Ok(())
}
