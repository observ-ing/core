//! HTTP-backed `TableSource` plugins that surface the tap-ingester service's
//! runtime interface in the admin browser.
//!
//! The ingester keeps its live state in memory and exposes it as JSON — its
//! own counters and recent events at `/api/stats`, and the embedded Tap's
//! repo/record/buffer counts and cursors at `/api/tap-stats`. These tables
//! fetch those endpoints over HTTP and map the responses into rows, so the
//! ingester's interface is browseable from the same auth-gated admin surface
//! as the Postgres tables, with no SQL backend behind it.
//!
//! This is the first non-Postgres `TableSource`: it proves the abstraction
//! holds across a process boundary. Registered by `admin_browse::router` when
//! `INGESTER_URL` is set.

use async_trait::async_trait;
use axum_admin::{AdminError, Column, ListQuery, Row, TableMeta, TableSource};
use serde_json::{json, Value};

/// Which slice of the ingester's JSON API a table presents.
#[derive(Clone, Copy)]
enum View {
    /// The last-N firehose events: type, action, uri, time. From `/api/stats`.
    RecentEvents,
    /// The ingester's scalar state (connection, uptime, counters) as
    /// metric/value rows. From `/api/stats`.
    Stats,
    /// The embedded Tap's state — repo/record/buffer counts and cursors — as
    /// metric/value rows. From `/api/tap-stats`.
    TapState,
}

impl View {
    /// The ingester endpoint this view reads.
    fn endpoint(self) -> &'static str {
        match self {
            View::RecentEvents | View::Stats => "/api/stats",
            View::TapState => "/api/tap-stats",
        }
    }

    /// The table name within the `ingester` group.
    fn name(self) -> &'static str {
        match self {
            View::RecentEvents => "recent_events",
            View::Stats => "stats",
            View::TapState => "tap_state",
        }
    }
}

/// One ingester table, backed by an HTTP GET to the ingester's JSON API.
pub struct IngesterApi {
    client: reqwest::Client,
    base_url: String,
    view: View,
}

impl IngesterApi {
    /// Build every ingester table against `base_url` (e.g.
    /// `http://localhost:9000`). They share one `reqwest::Client`.
    pub fn tables(base_url: &str) -> Vec<IngesterApi> {
        let base = base_url.trim_end_matches('/').to_string();
        let client = reqwest::Client::new();
        [View::RecentEvents, View::Stats, View::TapState]
            .into_iter()
            .map(|view| IngesterApi {
                client: client.clone(),
                base_url: base.clone(),
                view,
            })
            .collect()
    }

    /// Fetch and parse this view's endpoint.
    async fn fetch(&self) -> Result<Value, AdminError> {
        let url = format!("{}{}", self.base_url, self.view.endpoint());
        self.client
            .get(&url)
            .send()
            .await
            .map_err(AdminError::backend)?
            .error_for_status()
            .map_err(AdminError::backend)?
            .json::<Value>()
            .await
            .map_err(AdminError::backend)
    }

    /// Map a fetched snapshot into the rows for this view.
    fn rows_from(&self, snapshot: &Value) -> Vec<Row> {
        match self.view {
            // Events already carry {type, action, uri, time}; pass them through.
            View::RecentEvents => snapshot
                .get("recentEvents")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            View::Stats => {
                let mut rows = vec![
                    metric_row("connected", snapshot.get("connected")),
                    metric_row("uptime_seconds", snapshot.get("uptime")),
                ];
                if let Some(counters) = snapshot.get("stats").and_then(Value::as_object) {
                    for (name, value) in counters {
                        rows.push(json!({ "metric": name, "value": value }));
                    }
                }
                rows
            }
            View::TapState => {
                let cursors = snapshot.get("cursors");
                let mut rows = vec![
                    metric_row("repo_count", snapshot.get("repoCount")),
                    metric_row("record_count", snapshot.get("recordCount")),
                    metric_row("outbox_buffer", snapshot.get("outboxBuffer")),
                    metric_row("resync_buffer", snapshot.get("resyncBuffer")),
                    metric_row("cursor_firehose", cursors.and_then(|c| c.get("firehose"))),
                    metric_row(
                        "cursor_list_repos",
                        cursors.and_then(|c| c.get("listRepos")),
                    ),
                ];
                // `/api/tap-stats` reports partial failures in an `errors`
                // array rather than 500-ing; surface them as a row when present.
                if let Some(errors) = snapshot.get("errors").and_then(Value::as_array) {
                    if !errors.is_empty() {
                        rows.push(json!({ "metric": "errors", "value": errors }));
                    }
                }
                rows
            }
        }
    }
}

/// Build a `{metric, value}` row, treating a missing field as null.
fn metric_row(name: &str, value: Option<&Value>) -> Row {
    json!({ "metric": name, "value": value.cloned().unwrap_or(Value::Null) })
}

/// Columns are static per view — the shapes are fixed, so there's nothing to
/// introspect.
fn columns(names: &[&str]) -> Vec<Column> {
    names
        .iter()
        .map(|n| Column {
            name: (*n).to_string(),
            data_type: "json".to_string(),
            nullable: true,
        })
        .collect()
}

#[async_trait]
impl TableSource for IngesterApi {
    fn group(&self) -> &str {
        "ingester"
    }

    fn name(&self) -> &str {
        self.view.name()
    }

    async fn meta(&self) -> Result<TableMeta, AdminError> {
        let (cols, pk) = match self.view {
            View::RecentEvents => (columns(&["type", "action", "uri", "time"]), "uri"),
            View::Stats | View::TapState => (columns(&["metric", "value"]), "metric"),
        };
        Ok(TableMeta {
            columns: cols,
            primary_key: Some(pk.to_string()),
        })
    }

    async fn list(&self, _meta: &TableMeta, _query: &ListQuery) -> Result<Vec<Row>, AdminError> {
        // These datasets are tiny (≤10 events, a handful of metrics), so we
        // return the whole snapshot and ignore paging/search.
        Ok(self.rows_from(&self.fetch().await?))
    }

    async fn get(&self, meta: &TableMeta, pk: &str) -> Result<Option<Row>, AdminError> {
        let key = meta
            .primary_key
            .as_deref()
            .ok_or(AdminError::NoPrimaryKey)?;
        Ok(self
            .rows_from(&self.fetch().await?)
            .into_iter()
            .find(|row| row.get(key).and_then(Value::as_str) == Some(pk)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A snapshot shaped like tap-ingester's `/api/stats` response.
    fn snapshot() -> Value {
        json!({
            "connected": true,
            "uptime": 3600,
            "stats": { "occurrences": 12, "errors": 0 },
            "recentEvents": [
                { "type": "occurrence", "action": "create", "uri": "at://a", "time": "2026-01-01T00:00:00Z" },
                { "type": "like", "action": "create", "uri": "at://b", "time": "2026-01-01T00:01:00Z" }
            ]
        })
    }

    fn table(view_name: &str) -> IngesterApi {
        IngesterApi::tables("http://ingester")
            .into_iter()
            .find(|t| t.name() == view_name)
            .expect("view exists")
    }

    #[test]
    fn recent_events_pass_through() {
        let rows = table("recent_events").rows_from(&snapshot());
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["uri"], "at://a");
        assert_eq!(rows[1]["type"], "like");
    }

    #[test]
    fn stats_flatten_to_metric_value_rows() {
        let rows = table("stats").rows_from(&snapshot());
        // connected + uptime_seconds + the two counters.
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[0], json!({ "metric": "connected", "value": true }));
        assert_eq!(
            rows[1],
            json!({ "metric": "uptime_seconds", "value": 3600 })
        );
        // Every row is keyed by the `metric` primary key.
        assert!(rows.iter().all(|r| r.get("metric").is_some()));
    }

    #[test]
    fn tap_state_flattens_counts_and_cursors() {
        let snapshot = json!({
            "repoCount": 42,
            "recordCount": 1000,
            "outboxBuffer": 3,
            "resyncBuffer": 0,
            "cursors": { "firehose": 12345, "listRepos": "abc" },
            "errors": []
        });
        let rows = table("tap_state").rows_from(&snapshot);
        // 4 counts + 2 cursors; no `errors` row since the array is empty.
        assert_eq!(rows.len(), 6);
        assert_eq!(rows[0], json!({ "metric": "repo_count", "value": 42 }));
        assert_eq!(
            rows[4],
            json!({ "metric": "cursor_firehose", "value": 12345 })
        );
        assert_eq!(
            rows[5],
            json!({ "metric": "cursor_list_repos", "value": "abc" })
        );
    }

    #[test]
    fn tap_state_surfaces_errors_when_present() {
        let snapshot = json!({ "errors": ["repo_count: boom"] });
        let rows = table("tap_state").rows_from(&snapshot);
        let errors = rows.iter().find(|r| r["metric"] == "errors").unwrap();
        assert_eq!(errors["value"], json!(["repo_count: boom"]));
        // Missing counts/cursors still render as null rows.
        assert_eq!(rows[0], json!({ "metric": "repo_count", "value": null }));
    }

    #[test]
    fn missing_fields_become_null() {
        let rows = table("stats").rows_from(&json!({}));
        assert_eq!(rows[0], json!({ "metric": "connected", "value": null }));
    }

    #[test]
    fn base_url_trailing_slash_trimmed() {
        let t = IngesterApi::tables("http://ingester/");
        assert_eq!(t[0].base_url, "http://ingester");
    }
}
