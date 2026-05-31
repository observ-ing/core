//! Minimal Django-admin-style browser, exposed as an `axum::Router`.
//!
//! The core is storage-agnostic: every table is a [`TableSource`] plugin.
//! The Postgres/sqlx implementation lives in [`postgres`] behind the
//! `postgres` feature (on by default). To browse something that isn't a
//! Postgres table — an in-memory list, a remote API, another database —
//! implement [`TableSource`] and register it the same way.
//!
//! Read-only sketch. Mount it under any path:
//!
//! ```ignore
//! use axum_admin::{Admin, postgres::PgTable};
//!
//! let admin = Admin::new()
//!     .table(PgTable::new(pool.clone(), "public", "posts").searchable(["title", "body"]))
//!     .table(PgTable::new(pool.clone(), "public", "users").display_name("Users"));
//!
//! let app = axum::Router::new().nest("/admin", admin.into_router("/admin"));
//! ```
//!
//! Tables are addressed by `(group, name)`. For Postgres the group is the
//! schema — Postgres allows the same name in different schemas, and
//! `information_schema` introspection needs the schema to find columns.
//! URLs are namespaced as `/{group}/{name}` and `/{group}/{name}/{pk}`, in
//! the style of Django admin's `/{app}/{model}/`.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use serde_json::Value as JsonValue;

#[cfg(feature = "postgres")]
pub mod postgres;

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

/// One browsable table. This is the plugin boundary: the core knows how to
/// route and render, a `TableSource` knows how to fetch.
///
/// Implementations are stored as `dyn TableSource` behind the registry, so
/// the trait is object-safe (async methods go through `async_trait`).
///
/// The handler calls [`meta`](TableSource::meta) once per request and passes
/// the result into [`list`](TableSource::list) / [`get`](TableSource::get),
/// so a source needn't re-introspect to learn its own columns or primary key.
#[async_trait::async_trait]
pub trait TableSource: Send + Sync {
    /// URL/group identity. `group` namespaces `name`; Postgres uses the
    /// schema. Together they form the registry key and the URL path.
    fn group(&self) -> &str;

    /// The table's name within its group.
    fn name(&self) -> &str;

    /// Human-facing label for the index and headings. Defaults to [`name`](TableSource::name).
    fn display_name(&self) -> &str {
        self.name()
    }

    /// Short label for the datastore backing this table — e.g. `"postgres"`,
    /// `"http"`. Shown beside each entry in the UI so a remote/HTTP source is
    /// visibly distinct from a real database table rather than blending in.
    /// Defaults to `"—"`.
    fn datastore(&self) -> &str {
        "—"
    }

    /// Whether to render a search box and pass `q` through to [`list`](TableSource::list).
    fn searchable(&self) -> bool {
        false
    }

    /// Describe the columns and primary key. Called once per request.
    async fn meta(&self) -> Result<TableMeta, AdminError>;

    /// Fetch a page of rows. `meta` is the value just returned by
    /// [`meta`](TableSource::meta); `query` carries the search needle and page.
    async fn list(&self, meta: &TableMeta, query: &ListQuery) -> Result<Vec<Row>, AdminError>;

    /// Fetch a single row by its (stringified) primary key. `None` when no
    /// such row exists.
    async fn get(&self, meta: &TableMeta, pk: &str) -> Result<Option<Row>, AdminError>;
}

/// A row, as a JSON object keyed by column name. JSON is the neutral wire
/// format between a source and the renderer, so the core depends on
/// `serde_json` but not on any particular database.
pub type Row = JsonValue;

/// A single column's metadata.
#[derive(Debug, Clone)]
pub struct Column {
    pub name: String,
    /// Backend-specific type label, shown as-is (e.g. Postgres `data_type`).
    pub data_type: String,
    pub nullable: bool,
}

/// What a source reports about its shape.
#[derive(Debug, Default)]
pub struct TableMeta {
    pub columns: Vec<Column>,
    /// Single-column primary key, if any. `None` disables the detail view.
    pub primary_key: Option<String>,
}

/// Query parameters shared by every list view.
#[derive(Deserialize, Default, Debug)]
pub struct ListQuery {
    /// Free-text search needle, if the table is searchable.
    pub q: Option<String>,
    /// Zero-based page index.
    pub page: Option<i64>,
}

// ---------------------------------------------------------------------------
// Registry / public API
// ---------------------------------------------------------------------------

pub struct Admin {
    /// Keyed by `(group, name)` so two groups can have same-named tables.
    /// `BTreeMap` ordering naturally groups by `group` in the index page.
    sources: BTreeMap<(String, String), Box<dyn TableSource>>,
    prefix: String,
}

impl Default for Admin {
    fn default() -> Self {
        Self::new()
    }
}

/// Internal handler state.
struct AdminState {
    admin: Admin,
}

impl Admin {
    pub fn new() -> Self {
        Self {
            sources: BTreeMap::new(),
            prefix: "/admin".to_string(),
        }
    }

    /// Register a table plugin. Its `(group, name)` becomes the registry key
    /// and URL path; a later registration with the same key replaces it.
    pub fn table<T: TableSource + 'static>(mut self, source: T) -> Self {
        let key = (source.group().to_string(), source.name().to_string());
        self.sources.insert(key, Box::new(source));
        self
    }

    /// Build the router. `prefix` is the path you'll mount this at — e.g.
    /// `/admin` if you do `Router::new().nest("/admin", admin.into_router("/admin"))`.
    /// Used to emit absolute hrefs that don't depend on whether the request URL
    /// has a trailing slash.
    pub fn into_router(mut self, prefix: &str) -> Router {
        self.prefix = normalize_prefix(prefix);
        let state = Arc::new(AdminState { admin: self });
        Router::new()
            .route("/", get(index))
            .route("/{group}/{name}", get(list))
            .route("/{group}/{name}/{pk}", get(detail))
            .with_state(state)
    }
}

/// Strip a trailing slash so we can `format!("{prefix}/...")` cleanly.
/// Empty input becomes `""` (mounted at root).
fn normalize_prefix(p: &str) -> String {
    p.trim_end_matches('/').to_string()
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn index(State(state): State<Arc<AdminState>>) -> Html<String> {
    let admin = &state.admin;
    let mut body = String::from("<h1>Admin</h1>");

    // BTreeMap iteration is sorted by `(group, name)`, so we can group by
    // `group` with a single pass.
    let mut current_group: Option<&str> = None;
    for ((group, name), source) in &admin.sources {
        if current_group != Some(group.as_str()) {
            if current_group.is_some() {
                body.push_str("</ul>");
            }
            body.push_str(&format!("<h2>{}</h2><ul>", html_escape(group)));
            current_group = Some(group.as_str());
        }
        body.push_str(&format!(
            r#"<li><a href="{prefix}/{group}/{name}">{label}</a> <span class="ds">{ds}</span></li>"#,
            prefix = html_escape(&admin.prefix),
            group = html_escape(group),
            name = html_escape(name),
            label = html_escape(source.display_name()),
            ds = html_escape(source.datastore()),
        ));
    }
    if current_group.is_some() {
        body.push_str("</ul>");
    }
    Html(layout("Admin", &body))
}

async fn list(
    State(state): State<Arc<AdminState>>,
    Path((group, name)): Path<(String, String)>,
    Query(q): Query<ListQuery>,
) -> Result<Html<String>, AdminError> {
    let admin = &state.admin;
    let source = admin
        .sources
        .get(&(group.clone(), name.clone()))
        .ok_or_else(|| AdminError::UnknownTable(format!("{group}.{name}")))?;

    let meta = source.meta().await?;
    let rows = source.list(&meta, &q).await?;
    let page = q.page.unwrap_or(0).max(0);

    Ok(Html(render_list(
        &admin.prefix,
        &group,
        &name,
        source.display_name(),
        source.datastore(),
        source.searchable(),
        &meta,
        &rows,
        page,
        &q.q,
    )))
}

async fn detail(
    State(state): State<Arc<AdminState>>,
    Path((group, name, pk_value)): Path<(String, String, String)>,
) -> Result<Html<String>, AdminError> {
    let admin = &state.admin;
    let source = admin
        .sources
        .get(&(group.clone(), name.clone()))
        .ok_or_else(|| AdminError::UnknownTable(format!("{group}.{name}")))?;

    let meta = source.meta().await?;
    let row = source
        .get(&meta, &pk_value)
        .await?
        .ok_or(AdminError::NotFound)?;

    Ok(Html(render_detail(
        &admin.prefix,
        &group,
        &name,
        source.datastore(),
        &meta,
        &row,
    )))
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)] // sketch: a request-context struct is more ceremony than value here.
fn render_list(
    prefix: &str,
    group: &str,
    name: &str,
    label: &str,
    datastore: &str,
    searchable: bool,
    meta: &TableMeta,
    rows: &[Row],
    page: i64,
    needle: &Option<String>,
) -> String {
    let pk = meta.primary_key.as_deref();

    let mut body = format!(
        r#"<p><a href="{prefix}">← admin</a></p><h1>{group}.{label} <span class="ds">{ds}</span></h1>"#,
        prefix = html_escape(prefix),
        group = html_escape(group),
        label = html_escape(label),
        ds = html_escape(datastore),
    );

    if searchable {
        let val = needle.as_deref().unwrap_or("");
        body.push_str(&format!(
            r#"<form method="get"><input name="q" value="{}" placeholder="search…"><button>go</button></form>"#,
            html_escape(val)
        ));
    }

    body.push_str("<table border=1 cellpadding=4><thead><tr>");
    for col in &meta.columns {
        body.push_str(&format!("<th>{}</th>", html_escape(&col.name)));
    }
    body.push_str("</tr></thead><tbody>");

    for row in rows {
        body.push_str("<tr>");
        for col in &meta.columns {
            let cell = row.get(&col.name).map(json_cell).unwrap_or_default();
            let is_pk = pk == Some(col.name.as_str());
            if is_pk {
                let raw = row
                    .get(&col.name)
                    .map(|v| match v {
                        JsonValue::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default();
                body.push_str(&format!(
                    r#"<td><a href="{prefix}/{group}/{name}/{pk}">{cell}</a></td>"#,
                    prefix = html_escape(prefix),
                    group = html_escape(group),
                    name = html_escape(name),
                    pk = url_encode(&raw),
                    cell = cell,
                ));
            } else {
                body.push_str(&format!("<td>{cell}</td>"));
            }
        }
        body.push_str("</tr>");
    }
    body.push_str("</tbody></table>");

    let prev = (page - 1).max(0);
    let next = page + 1;
    body.push_str(&format!(
        r#"<p><a href="?page={prev}">prev</a> · page {page} · <a href="?page={next}">next</a></p>"#
    ));

    layout(label, &body)
}

fn render_detail(
    prefix: &str,
    group: &str,
    name: &str,
    datastore: &str,
    meta: &TableMeta,
    row: &Row,
) -> String {
    let mut body = format!(
        r#"<p><a href="{prefix}/{group}/{name}">← {group}.{name}</a></p><h1>{group}.{name} detail <span class="ds">{ds}</span></h1><table border=1 cellpadding=4>"#,
        prefix = html_escape(prefix),
        group = html_escape(group),
        name = html_escape(name),
        ds = html_escape(datastore),
    );
    for col in &meta.columns {
        let cell = row.get(&col.name).map(json_cell).unwrap_or_default();
        body.push_str(&format!(
            "<tr><th align=left>{}</th><td>{}</td></tr>",
            html_escape(&col.name),
            cell
        ));
    }
    body.push_str("</table>");
    layout(&format!("{group}.{name} detail"), &body)
}

fn layout(title: &str, body: &str) -> String {
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>{title}</title>
<style>body{{font:14px/1.4 system-ui;margin:2rem;max-width:1100px}}
table{{border-collapse:collapse}}th,td{{vertical-align:top}}
a{{color:#0366d6}}
.ds{{font-size:.8em;font-weight:normal;color:#666;background:#f0f0f0;
border:1px solid #ddd;border-radius:3px;padding:0 .35em;vertical-align:middle}}
h1 .ds{{font-size:.5em}}</style></head><body>{body}</body></html>"#,
        title = html_escape(title),
        body = body,
    )
}

fn json_cell(v: &JsonValue) -> String {
    match v {
        JsonValue::Null => "<em>null</em>".into(),
        JsonValue::String(s) => html_escape(s),
        other => html_escape(&other.to_string()),
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn url_encode(s: &str) -> String {
    // Tiny encoder for path segments; sufficient for the sketch.
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Errors surfaced by the core or by a [`TableSource`]. Plugins report
/// backend failures via [`AdminError::backend`].
#[derive(Debug)]
pub enum AdminError {
    /// No source registered under the requested `(group, name)`.
    UnknownTable(String),
    /// The table has no single-column primary key, so it has no detail view.
    NoPrimaryKey,
    /// The requested row does not exist.
    NotFound,
    /// A plugin-specific failure (database error, network error, …).
    Backend(Box<dyn std::error::Error + Send + Sync>),
}

impl AdminError {
    /// Wrap a plugin error. Use this in `TableSource` implementations.
    pub fn backend(e: impl Into<Box<dyn std::error::Error + Send + Sync>>) -> Self {
        AdminError::Backend(e.into())
    }
}

impl std::fmt::Display for AdminError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AdminError::UnknownTable(t) => write!(f, "unknown table: {t}"),
            AdminError::NoPrimaryKey => write!(f, "table has no single-column primary key"),
            AdminError::NotFound => write!(f, "row not found"),
            AdminError::Backend(e) => write!(f, "backend error: {e}"),
        }
    }
}

impl std::error::Error for AdminError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            AdminError::Backend(e) => Some(&**e),
            _ => None,
        }
    }
}

impl IntoResponse for AdminError {
    fn into_response(self) -> Response {
        match self {
            AdminError::UnknownTable(t) => (
                StatusCode::NOT_FOUND,
                format!("unknown table: {t} (not registered with Admin)"),
            )
                .into_response(),
            AdminError::NoPrimaryKey => (
                StatusCode::BAD_REQUEST,
                "table has no single-column primary key".to_string(),
            )
                .into_response(),
            AdminError::NotFound => {
                (StatusCode::NOT_FOUND, "row not found".to_string()).into_response()
            }
            AdminError::Backend(e) => {
                tracing::error!(error = ?e, "axum-admin backend error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "backend error".to_string(),
                )
                    .into_response()
            }
        }
    }
}
