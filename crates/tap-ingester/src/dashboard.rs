//! Combined ingester + Tap dashboard for tap-ingester.
//!
//! Replaces the earlier `/tap/*` reverse proxy. Instead of exposing Tap's
//! admin surface to the public internet (which was problematic without
//! `TAP_ADMIN_PASSWORD` set), tap-ingester calls Tap's read-only stats
//! endpoints itself over loopback and renders the result alongside the
//! ingester's own counters on a single HTML page.
//!
//! Routes:
//!   GET /                    Combined HTML dashboard.
//!   GET /health              Cloud Run liveness probe (JSON).
//!   GET /api/stats           Ingester counters (JSON).
//!   GET /api/tap-stats       Tap state — repo/record/buffer counts and
//!                            cursors, fetched from the embedded Tap on
//!                            loopback (JSON).
//!   GET /api/failed-records  Recent rows from `ingester.failed_records`
//!                            (JSON) for the dashboard's failures panel.

use crate::{
    server::SharedState,
    types::{IngesterStats, RecentEvent},
};
use axum::{
    extract::State,
    response::{Html, Json},
    routing::get,
    Router,
};
use observing_db::failed_records;
use serde::Serialize;
use sqlx::postgres::PgPool;
use std::sync::Arc;
use tapped::TapClient;
use tokio::sync::OnceCell;
use tower_http::cors::CorsLayer;
use tracing::warn;

/// Shared by all dashboard routes.
///
/// `tap` is a `OnceCell` so the HTTP server can come up immediately
/// (Cloud Run TCP startup probe), even though the `TapClient` isn't
/// available until after `TapProcess::spawn_default` completes. While
/// the cell is empty, `/api/tap-stats` returns partial data with a
/// "not yet initialized" error rather than 500-ing the page.
#[derive(Clone)]
pub struct DashboardState {
    pub ingester: SharedState,
    pub tap: Arc<OnceCell<TapClient>>,
    /// Connected after `Database::connect` returns in `main`. Same
    /// late-init pattern as `tap`: the HTTP server comes up first so
    /// the Cloud Run TCP startup probe passes, and `/api/failed-records`
    /// reports "not yet initialized" until the pool lands.
    pub pool: Arc<OnceCell<PgPool>>,
}

pub fn router(state: DashboardState) -> Router {
    Router::new()
        .route("/", get(dashboard))
        .route("/health", get(health))
        .route("/api/stats", get(stats))
        .route("/api/tap-stats", get(tap_stats))
        .route("/api/failed-records", get(failed_records_handler))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    connected: bool,
}

async fn health(State(s): State<DashboardState>) -> Json<HealthResponse> {
    let ig = s.ingester.read().await;
    Json(HealthResponse {
        status: "ok",
        connected: ig.connected,
    })
}

#[derive(Serialize)]
struct StatsResponse {
    connected: bool,
    uptime: i64,
    stats: IngesterStats,
    #[serde(rename = "recentEvents")]
    recent_events: Vec<RecentEvent>,
}

async fn stats(State(s): State<DashboardState>) -> Json<StatsResponse> {
    let ig = s.ingester.read().await;
    let uptime = (chrono::Utc::now() - ig.started_at).num_seconds();
    Json(StatsResponse {
        connected: ig.connected,
        uptime,
        stats: ig.stats.clone(),
        recent_events: ig.recent_events.iter().cloned().collect(),
    })
}

#[derive(Serialize)]
struct TapCursors {
    firehose: Option<i64>,
    #[serde(rename = "listRepos")]
    list_repos: Option<String>,
}

#[derive(Serialize)]
struct TapStatsResponse {
    #[serde(rename = "repoCount")]
    repo_count: Option<u64>,
    #[serde(rename = "recordCount")]
    record_count: Option<u64>,
    #[serde(rename = "outboxBuffer")]
    outbox_buffer: Option<u64>,
    #[serde(rename = "resyncBuffer")]
    resync_buffer: Option<u64>,
    cursors: Option<TapCursors>,
    /// Concatenated error messages if any of the parallel fetches failed.
    /// Successful fields above remain populated; this is for surfacing
    /// partial failures in the dashboard rather than 500-ing the whole
    /// page.
    errors: Vec<String>,
}

async fn tap_stats(State(s): State<DashboardState>) -> Json<TapStatsResponse> {
    let Some(tap) = s.tap.get() else {
        return Json(TapStatsResponse {
            repo_count: None,
            record_count: None,
            outbox_buffer: None,
            resync_buffer: None,
            cursors: None,
            errors: vec!["tap client not yet initialized".to_string()],
        });
    };
    let (repo_count, record_count, outbox_buffer, resync_buffer, cursors) = tokio::join!(
        tap.repo_count(),
        tap.record_count(),
        tap.outbox_buffer(),
        tap.resync_buffer(),
        tap.cursors(),
    );

    let mut errors = Vec::new();
    if let Err(e) = &repo_count {
        errors.push(format!("repo_count: {e}"));
    }
    if let Err(e) = &record_count {
        errors.push(format!("record_count: {e}"));
    }
    if let Err(e) = &outbox_buffer {
        errors.push(format!("outbox_buffer: {e}"));
    }
    if let Err(e) = &resync_buffer {
        errors.push(format!("resync_buffer: {e}"));
    }
    if let Err(e) = &cursors {
        errors.push(format!("cursors: {e}"));
    }

    Json(TapStatsResponse {
        repo_count: repo_count.ok(),
        record_count: record_count.ok(),
        outbox_buffer: outbox_buffer.ok(),
        resync_buffer: resync_buffer.ok(),
        cursors: cursors.ok().map(|c| TapCursors {
            firehose: c.firehose,
            list_repos: c.list_repos,
        }),
        errors,
    })
}

#[derive(Serialize)]
struct FailedRecordsResponse {
    total: Option<i64>,
    items: Vec<failed_records::FailedRecordRow>,
    /// Populated when the ledger query failed; the dashboard renders this
    /// instead of 500-ing the whole page. `total` and `items` may still be
    /// partially set if one query succeeded and the other didn't.
    error: Option<String>,
}

async fn failed_records_handler(State(s): State<DashboardState>) -> Json<FailedRecordsResponse> {
    let Some(pool) = s.pool.get() else {
        return Json(FailedRecordsResponse {
            total: None,
            items: Vec::new(),
            error: Some("database pool not yet initialized".to_string()),
        });
    };
    let (items_res, total_res) = tokio::join!(
        failed_records::list_recent(pool, 50),
        failed_records::count_total(pool),
    );

    let mut error = None;
    let items = match items_res {
        Ok(rows) => rows,
        Err(e) => {
            warn!(error = %e, "failed_records list query failed");
            error = Some(format!("list: {e}"));
            Vec::new()
        }
    };
    let total = match total_res {
        Ok(n) => Some(n),
        Err(e) => {
            warn!(error = %e, "failed_records count query failed");
            // Concatenate so a list error doesn't hide a count error.
            error = Some(match error {
                Some(prev) => format!("{prev}; count: {e}"),
                None => format!("count: {e}"),
            });
            None
        }
    };

    Json(FailedRecordsResponse {
        total,
        items,
        error,
    })
}

async fn dashboard() -> Html<&'static str> {
    Html(DASHBOARD_HTML)
}

const DASHBOARD_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Observ.ing Tap Ingester</title>
  <style>
    body { font-family: monospace; padding: 1rem; max-width: 60rem; }
    table { border-collapse: collapse; margin-bottom: 1rem; }
    td, th { text-align: left; padding: 0.25rem 1rem 0.25rem 0; }
    .connected { color: green; }
    .disconnected { color: red; }
    .err { color: red; }
    h2 { margin-top: 1.5rem; }
    .event { margin: 0.25rem 0; }
    .errors { color: red; white-space: pre-wrap; margin: 0.5rem 0; }
  </style>
</head>
<body>
  <h1>Observ.ing Tap Ingester</h1>

  <h2>Ingester</h2>
  <table>
    <tr><td>Status</td><td id="status">Loading...</td></tr>
    <tr><td>Uptime</td><td id="uptime">-</td></tr>
    <tr><td>Occurrences</td><td id="occurrences">0</td></tr>
    <tr><td>Identifications</td><td id="identifications">0</td></tr>
    <tr><td>Comments</td><td id="comments">0</td></tr>
    <tr><td>Interactions</td><td id="interactions">0</td></tr>
    <tr><td>Likes</td><td id="likes">0</td></tr>
    <tr><td>Errors</td><td id="errors">0</td></tr>
  </table>

  <h2>Tap</h2>
  <table>
    <tr><td>Repos tracked</td><td id="tap-repo-count">-</td></tr>
    <tr><td>Records</td><td id="tap-record-count">-</td></tr>
    <tr><td>Outbox buffer</td><td id="tap-outbox-buffer">-</td></tr>
    <tr><td>Resync buffer</td><td id="tap-resync-buffer">-</td></tr>
    <tr><td>Firehose cursor</td><td id="tap-firehose-cursor">-</td></tr>
    <tr><td>List-repos cursor</td><td id="tap-list-repos-cursor">-</td></tr>
  </table>
  <div id="tap-errors" class="errors"></div>

  <h2>Recent events</h2>
  <div id="recent-events">No events yet...</div>

  <h2>Failed records <span id="failed-total" style="font-weight: normal; color: #888;"></span></h2>
  <div id="failed-records-error" class="errors"></div>
  <div id="failed-records">Loading...</div>

  <script>
    function formatDuration(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    }

    function fmtNum(n) {
      return n == null ? '-' : Number(n).toLocaleString();
    }

    function fmtStr(s) {
      return s == null || s === '' ? '-' : s;
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    async function refresh() {
      try {
        const [stats, tap, failed] = await Promise.all([
          fetch('/api/stats').then(r => r.json()),
          fetch('/api/tap-stats').then(r => r.json()),
          fetch('/api/failed-records').then(r => r.json()),
        ]);

        const statusEl = document.getElementById('status');
        statusEl.textContent = stats.connected ? 'Connected' : 'Disconnected';
        statusEl.className = stats.connected ? 'connected' : 'disconnected';

        document.getElementById('uptime').textContent = formatDuration(stats.uptime);
        document.getElementById('occurrences').textContent = fmtNum(stats.stats.occurrences);
        document.getElementById('identifications').textContent = fmtNum(stats.stats.identifications);
        document.getElementById('comments').textContent = fmtNum(stats.stats.comments);
        document.getElementById('interactions').textContent = fmtNum(stats.stats.interactions);
        document.getElementById('likes').textContent = fmtNum(stats.stats.likes);
        document.getElementById('errors').textContent = fmtNum(stats.stats.errors);

        document.getElementById('tap-repo-count').textContent = fmtNum(tap.repoCount);
        document.getElementById('tap-record-count').textContent = fmtNum(tap.recordCount);
        document.getElementById('tap-outbox-buffer').textContent = fmtNum(tap.outboxBuffer);
        document.getElementById('tap-resync-buffer').textContent = fmtNum(tap.resyncBuffer);
        document.getElementById('tap-firehose-cursor').textContent = fmtNum(tap.cursors && tap.cursors.firehose);
        document.getElementById('tap-list-repos-cursor').textContent = fmtStr(tap.cursors && tap.cursors.listRepos);
        document.getElementById('tap-errors').textContent = (tap.errors && tap.errors.length) ? tap.errors.join('\n') : '';

        const eventsEl = document.getElementById('recent-events');
        if (!stats.recentEvents || stats.recentEvents.length === 0) {
          eventsEl.textContent = 'No events yet...';
        } else {
          eventsEl.innerHTML = stats.recentEvents.map(e =>
            '<div class="event">' + new Date(e.time).toLocaleTimeString() + ' [' + escapeHtml(e.type) + '] ' + escapeHtml(e.action) + ' ' + escapeHtml(e.uri) + '</div>'
          ).join('');
        }

        const totalEl = document.getElementById('failed-total');
        totalEl.textContent = failed.total != null ? '(' + fmtNum(failed.total) + ' total)' : '';
        document.getElementById('failed-records-error').textContent = failed.error || '';
        const failedEl = document.getElementById('failed-records');
        if (!failed.items || failed.items.length === 0) {
          failedEl.textContent = failed.error ? '' : 'No failed records.';
        } else {
          const rows = failed.items.map(r =>
            '<tr>' +
              '<td>' + new Date(r.last_attempt_at).toLocaleString() + '</td>' +
              '<td>' + fmtNum(r.attempts) + '</td>' +
              '<td>' + escapeHtml(r.collection) + '</td>' +
              '<td>' + escapeHtml(r.action) + '</td>' +
              '<td style="word-break: break-all;">' + escapeHtml(r.uri) + '</td>' +
              '<td class="err">' + escapeHtml(r.last_error) + '</td>' +
            '</tr>'
          ).join('');
          failedEl.innerHTML =
            '<table style="width: 100%;">' +
              '<thead><tr>' +
                '<th>Last attempt</th><th>Attempts</th><th>Collection</th><th>Action</th><th>URI</th><th>Error</th>' +
              '</tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>';
        }
      } catch (err) {
        const statusEl = document.getElementById('status');
        statusEl.textContent = 'Error fetching state';
        statusEl.className = 'err';
      }
    }

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>"#;
