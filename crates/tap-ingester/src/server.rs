//! Shared HTTP server state.
//!
//! `ServerState` is updated by the firehose consumer loop in `main.rs`
//! and read by the dashboard handlers in `dashboard.rs`. Tap manages
//! its own cursor server-side, so unlike a Jetstream-driven ingester
//! there's no client-side cursor or per-event "last processed" timing
//! tracked here.

use crate::types::{IngesterStats, RecentEvent};
use chrono::{DateTime, Utc};
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Default)]
pub struct ServerState {
    pub connected: bool,
    pub started_at: DateTime<Utc>,
    pub stats: IngesterStats,
    pub recent_events: VecDeque<RecentEvent>,
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            connected: false,
            started_at: Utc::now(),
            stats: IngesterStats::default(),
            recent_events: VecDeque::new(),
        }
    }

    pub fn add_recent_event(&mut self, event: RecentEvent) {
        self.recent_events.push_front(event);
        if self.recent_events.len() > 10 {
            self.recent_events.pop_back();
        }
    }
}

pub type SharedState = Arc<RwLock<ServerState>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_state_new() {
        let state = ServerState::new();
        assert!(!state.connected);
        assert_eq!(state.stats.occurrences, 0);
        assert!(state.recent_events.is_empty());
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
        assert_eq!(state.recent_events[0].event_type, "identification");
    }

    #[test]
    fn test_add_recent_event_limits_to_10() {
        let mut state = ServerState::new();
        for i in 0..15 {
            state.add_recent_event(RecentEvent {
                event_type: "occurrence".to_string(),
                action: "create".to_string(),
                uri: format!("at://test/{}", i),
                time: Utc::now(),
            });
        }
        assert_eq!(state.recent_events.len(), 10);
        assert_eq!(state.recent_events[0].uri, "at://test/14");
        assert_eq!(state.recent_events[9].uri, "at://test/5");
    }
}
