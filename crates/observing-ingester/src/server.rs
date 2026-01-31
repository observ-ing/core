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
        last_processed: state
            .last_processed
            .as_ref()
            .map(|lp| LastProcessedResponse {
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
  <title>Observ.ing Ingester</title>
  <style>
    body { font-family: monospace; padding: 1rem; }
    table { border-collapse: collapse; margin-bottom: 1rem; }
    td, th { text-align: left; padding: 0.25rem 1rem 0.25rem 0; }
    .connected { color: green; }
    .disconnected { color: red; }
    h2 { margin-top: 1rem; }
    .event { margin: 0.25rem 0; }
  </style>
</head>
<body>
  <h1>Observ.ing Ingester</h1>

  <table>
    <tr><td>Status</td><td id="status">Loading...</td></tr>
    <tr><td>Cursor</td><td id="cursor">-</td></tr>
    <tr><td>Uptime</td><td id="uptime">-</td></tr>
    <tr><td>Lag</td><td id="lag">-</td></tr>
  </table>

  <h2>Stats</h2>
  <table>
    <tr><td>Occurrences</td><td id="occurrences">0</td></tr>
    <tr><td>Identifications</td><td id="identifications">0</td></tr>
    <tr><td>Errors</td><td id="errors">0</td></tr>
  </table>

  <h2>Recent Events</h2>
  <div id="events">No events yet...</div>

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
      const lagMs = Date.now() - new Date(lastProcessed.time).getTime();
      if (lagMs < 0) return '0s';
      return formatDuration(Math.floor(lagMs / 1000));
    }

    async function refresh() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();

        const statusEl = document.getElementById('status');
        statusEl.textContent = data.connected ? 'Connected' : 'Disconnected';
        statusEl.className = data.connected ? 'connected' : 'disconnected';

        document.getElementById('cursor').textContent = data.cursor?.toLocaleString() || '-';
        document.getElementById('uptime').textContent = formatDuration(data.uptime);
        document.getElementById('lag').textContent = formatLag(data.lastProcessed);
        document.getElementById('occurrences').textContent = data.stats.occurrences.toLocaleString();
        document.getElementById('identifications').textContent = data.stats.identifications.toLocaleString();
        document.getElementById('errors').textContent = data.stats.errors.toLocaleString();

        const eventsEl = document.getElementById('events');
        if (data.recentEvents.length === 0) {
          eventsEl.textContent = 'No events yet...';
        } else {
          eventsEl.innerHTML = data.recentEvents.map(e =>
            '<div class="event">' + new Date(e.time).toLocaleTimeString() + ' [' + e.type + '] ' + e.action + ' ' + e.uri + '</div>'
          ).join('');
        }
      } catch (err) {
        document.getElementById('status').textContent = 'Error';
        document.getElementById('status').className = 'disconnected';
      }
    }

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>"#;

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[test]
    fn test_server_state_new() {
        let state = ServerState::new();
        assert!(!state.connected);
        assert!(state.cursor.is_none());
        assert_eq!(state.stats.occurrences, 0);
        assert_eq!(state.stats.identifications, 0);
        assert_eq!(state.stats.errors, 0);
        assert!(state.recent_events.is_empty());
        assert!(state.last_processed.is_none());
    }

    #[test]
    fn test_server_state_default() {
        let state = ServerState::default();
        assert!(!state.connected);
        assert!(state.cursor.is_none());
    }

    #[test]
    fn test_add_recent_event() {
        let mut state = ServerState::new();

        // Add a single event
        state.add_recent_event(RecentEvent {
            event_type: "occurrence".to_string(),
            action: "create".to_string(),
            uri: "at://test/1".to_string(),
            time: Utc::now(),
        });

        assert_eq!(state.recent_events.len(), 1);
        assert_eq!(state.recent_events[0].event_type, "occurrence");
    }

    #[test]
    fn test_add_recent_event_prepends() {
        let mut state = ServerState::new();

        state.add_recent_event(RecentEvent {
            event_type: "occurrence".to_string(),
            action: "create".to_string(),
            uri: "at://test/first".to_string(),
            time: Utc::now(),
        });

        state.add_recent_event(RecentEvent {
            event_type: "identification".to_string(),
            action: "create".to_string(),
            uri: "at://test/second".to_string(),
            time: Utc::now(),
        });

        assert_eq!(state.recent_events.len(), 2);
        // Most recent should be first
        assert_eq!(state.recent_events[0].event_type, "identification");
        assert_eq!(state.recent_events[1].event_type, "occurrence");
    }

    #[test]
    fn test_add_recent_event_limits_to_10() {
        let mut state = ServerState::new();

        // Add 15 events
        for i in 0..15 {
            state.add_recent_event(RecentEvent {
                event_type: "occurrence".to_string(),
                action: "create".to_string(),
                uri: format!("at://test/{}", i),
                time: Utc::now(),
            });
        }

        // Should only keep 10
        assert_eq!(state.recent_events.len(), 10);
        // Most recent (14) should be first
        assert_eq!(state.recent_events[0].uri, "at://test/14");
        // Oldest kept (5) should be last
        assert_eq!(state.recent_events[9].uri, "at://test/5");
    }

    #[tokio::test]
    async fn test_health_endpoint() {
        let state: SharedState = Arc::new(RwLock::new(ServerState::new()));
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(json["status"], "ok");
        assert_eq!(json["connected"], false);
        assert!(json["cursor"].is_null());
    }

    #[tokio::test]
    async fn test_health_endpoint_when_connected() {
        let state: SharedState = Arc::new(RwLock::new(ServerState::new()));
        {
            let mut s = state.write().await;
            s.connected = true;
            s.cursor = Some(12345);
        }
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(json["status"], "ok");
        assert_eq!(json["connected"], true);
        assert_eq!(json["cursor"], 12345);
    }

    #[tokio::test]
    async fn test_stats_endpoint() {
        let state: SharedState = Arc::new(RwLock::new(ServerState::new()));
        {
            let mut s = state.write().await;
            s.connected = true;
            s.cursor = Some(99999);
            s.stats.occurrences = 42;
            s.stats.identifications = 7;
            s.stats.errors = 1;
        }
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/stats")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(json["connected"], true);
        assert_eq!(json["cursor"], 99999);
        assert_eq!(json["stats"]["occurrences"], 42);
        assert_eq!(json["stats"]["identifications"], 7);
        assert_eq!(json["stats"]["errors"], 1);
        assert!(json["uptime"].as_i64().unwrap() >= 0);
    }

    #[tokio::test]
    async fn test_dashboard_endpoint() {
        let state: SharedState = Arc::new(RwLock::new(ServerState::new()));
        let router = create_router(state);

        let response = router
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let html = String::from_utf8(body.to_vec()).unwrap();

        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("Observ.ing Ingester"));
    }

    #[tokio::test]
    async fn test_stats_with_recent_events() {
        let state: SharedState = Arc::new(RwLock::new(ServerState::new()));
        {
            let mut s = state.write().await;
            s.add_recent_event(RecentEvent {
                event_type: "occurrence".to_string(),
                action: "create".to_string(),
                uri: "at://test/event1".to_string(),
                time: Utc::now(),
            });
        }
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/stats")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(json["recentEvents"].as_array().unwrap().len(), 1);
        assert_eq!(json["recentEvents"][0]["type"], "occurrence");
        assert_eq!(json["recentEvents"][0]["action"], "create");
    }

    #[tokio::test]
    async fn test_stats_with_last_processed() {
        let state: SharedState = Arc::new(RwLock::new(ServerState::new()));
        {
            let mut s = state.write().await;
            s.last_processed = Some(CommitTimingInfo {
                seq: 555,
                time: Utc::now(),
            });
        }
        let router = create_router(state);

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/stats")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(json["lastProcessed"]["seq"], 555);
        assert!(json["lastProcessed"]["time"].is_string());
    }
}
