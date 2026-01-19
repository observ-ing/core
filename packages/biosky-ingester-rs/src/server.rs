//! HTTP server for health checks and stats dashboard
//!
//! Provides /health, /api/stats, and / (dashboard) endpoints.

use crate::types::{CommitTimingInfo, IngesterStats, RecentEvent};
use axum::{
    extract::State,
    response::{Html, Json},
    routing::get,
    Router,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::info;

/// Shared state for the HTTP server
#[derive(Debug, Default)]
pub struct ServerState {
    pub connected: bool,
    pub cursor: Option<i64>,
    pub started_at: DateTime<Utc>,
    pub stats: IngesterStats,
    pub recent_events: Vec<RecentEvent>,
    pub last_processed: Option<CommitTimingInfo>,
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            connected: false,
            cursor: None,
            started_at: Utc::now(),
            stats: IngesterStats::default(),
            recent_events: Vec::new(),
            last_processed: None,
        }
    }

    pub fn add_recent_event(&mut self, event: RecentEvent) {
        self.recent_events.insert(0, event);
        if self.recent_events.len() > 10 {
            self.recent_events.pop();
        }
    }
}

pub type SharedState = Arc<RwLock<ServerState>>;

/// Health check response
#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    connected: bool,
    cursor: Option<i64>,
}

/// Stats response
#[derive(Serialize)]
struct StatsResponse {
    connected: bool,
    cursor: Option<i64>,
    uptime: i64,
    stats: IngesterStats,
    #[serde(rename = "recentEvents")]
    recent_events: Vec<RecentEvent>,
    #[serde(rename = "lastProcessed")]
    last_processed: Option<LastProcessedResponse>,
}

#[derive(Serialize)]
struct LastProcessedResponse {
    seq: i64,
    time: String,
}

/// Create the HTTP router
pub fn create_router(state: SharedState) -> Router {
    Router::new()
        .route("/", get(dashboard))
        .route("/health", get(health))
        .route("/api/stats", get(stats))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Start the HTTP server
pub async fn start_server(state: SharedState, port: u16) -> std::io::Result<()> {
    let router = create_router(state);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    info!("Starting HTTP server on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await
}

async fn health(State(state): State<SharedState>) -> Json<HealthResponse> {
    let state = state.read().await;
    Json(HealthResponse {
        status: "ok",
        connected: state.connected,
        cursor: state.cursor,
    })
}

async fn stats(State(state): State<SharedState>) -> Json<StatsResponse> {
    let state = state.read().await;
    let uptime = (Utc::now() - state.started_at).num_seconds();

    Json(StatsResponse {
        connected: state.connected,
        cursor: state.cursor,
        uptime,
        stats: state.stats.clone(),
        recent_events: state.recent_events.clone(),
        last_processed: state.last_processed.as_ref().map(|lp| LastProcessedResponse {
            seq: lp.seq,
            time: lp.time.to_rfc3339(),
        }),
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
  <title>BioSky Ingester (Rust)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 2rem;
      min-height: 100vh;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #38bdf8; }
    .badge {
      display: inline-block;
      background: #f97316;
      color: white;
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      margin-left: 0.5rem;
      vertical-align: middle;
    }
    .card {
      background: #1e293b;
      border-radius: 0.5rem;
      padding: 1.5rem;
      margin-bottom: 1rem;
    }
    .status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 0;
      border-bottom: 1px solid #334155;
    }
    .status-row:last-child { border-bottom: none; }
    .label { color: #94a3b8; }
    .value { font-weight: 600; font-family: monospace; }
    .status-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 0.5rem;
    }
    .status-dot.connected { background: #22c55e; }
    .status-dot.disconnected { background: #ef4444; }
    .events { margin-top: 1rem; }
    .event {
      padding: 0.75rem;
      background: #0f172a;
      border-radius: 0.25rem;
      margin-bottom: 0.5rem;
      font-family: monospace;
      font-size: 0.875rem;
    }
    .event-time { color: #64748b; }
    .event-type {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      margin-right: 0.5rem;
    }
    .event-type.occurrence { background: #166534; color: #bbf7d0; }
    .event-type.identification { background: #1e40af; color: #bfdbfe; }
    .event-action { color: #fbbf24; }
    .event-uri {
      color: #94a3b8;
      word-break: break-all;
      display: block;
      margin-top: 0.25rem;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-top: 1rem;
    }
    .stat {
      text-align: center;
      padding: 1rem;
      background: #0f172a;
      border-radius: 0.25rem;
    }
    .stat-value { font-size: 2rem; font-weight: bold; color: #38bdf8; }
    .stat-label { color: #64748b; font-size: 0.875rem; }
    .no-events { color: #64748b; font-style: italic; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🌿 BioSky Ingester <span class="badge">Rust</span></h1>

    <div class="card">
      <div class="status-row">
        <span class="label">Status</span>
        <span class="value" id="status">Loading...</span>
      </div>
      <div class="status-row">
        <span class="label">Cursor</span>
        <span class="value" id="cursor">-</span>
      </div>
      <div class="status-row">
        <span class="label">Uptime</span>
        <span class="value" id="uptime">-</span>
      </div>
      <div class="status-row">
        <span class="label">Lag</span>
        <span class="value" id="lag">-</span>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-bottom: 0.5rem; color: #94a3b8; font-size: 0.875rem; text-transform: uppercase;">Session Stats</h2>
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-value" id="occurrences">0</div>
          <div class="stat-label">Occurrences</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="identifications">0</div>
          <div class="stat-label">Identifications</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="errors">0</div>
          <div class="stat-label">Errors</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-bottom: 0.5rem; color: #94a3b8; font-size: 0.875rem; text-transform: uppercase;">Recent Events</h2>
      <div class="events" id="events">
        <div class="no-events">No events yet...</div>
      </div>
    </div>
  </div>

  <script>
    function formatDuration(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    }

    function formatLag(lastProcessed) {
      if (!lastProcessed || !lastProcessed.time) return '-';
      const eventTime = new Date(lastProcessed.time).getTime();
      const now = Date.now();
      const lagMs = now - eventTime;
      if (lagMs < 0) return '0s';
      const lagSeconds = Math.floor(lagMs / 1000);
      return formatDuration(lagSeconds);
    }

    function formatTime(iso) {
      return new Date(iso).toLocaleTimeString();
    }

    async function refresh() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();

        document.getElementById('status').innerHTML =
          '<span class="status-dot ' + (data.connected ? 'connected' : 'disconnected') + '"></span>' +
          (data.connected ? 'Connected' : 'Disconnected');
        document.getElementById('cursor').textContent = data.cursor?.toLocaleString() || '-';
        document.getElementById('uptime').textContent = formatDuration(data.uptime);
        document.getElementById('lag').textContent = formatLag(data.lastProcessed);
        document.getElementById('occurrences').textContent = data.stats.occurrences.toLocaleString();
        document.getElementById('identifications').textContent = data.stats.identifications.toLocaleString();
        document.getElementById('errors').textContent = data.stats.errors.toLocaleString();

        const eventsEl = document.getElementById('events');
        if (data.recentEvents.length === 0) {
          eventsEl.innerHTML = '<div class="no-events">No events yet...</div>';
        } else {
          eventsEl.innerHTML = data.recentEvents.map(e =>
            '<div class="event">' +
              '<span class="event-time">' + formatTime(e.time) + '</span> ' +
              '<span class="event-type ' + e.type + '">' + e.type + '</span>' +
              '<span class="event-action">' + e.action + '</span>' +
              '<span class="event-uri">' + e.uri + '</span>' +
            '</div>'
          ).join('');
        }
      } catch (err) {
        document.getElementById('status').innerHTML =
          '<span class="status-dot disconnected"></span>Error';
      }
    }

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>"#;
