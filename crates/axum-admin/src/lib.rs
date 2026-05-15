//! Minimal Django-admin-style browser for Postgres, exposed as an `axum::Router`.
//!
//! Read-only sketch. Mount it under any path:
//!
//! ```ignore
//! let admin = axum_admin::Admin::new(pool)
//!     .table("public", "posts", |t| t.searchable(["title", "body"]))
//!     .table("public", "users", |t| t.display_name("Users"));
//!
//! let app = axum::Router::new().nest("/admin", admin.into_router("/admin"));
//! ```
//!
//! Tables are addressed by `(schema, name)` — Postgres allows the same name
//! in different schemas, and `information_schema` introspection needs the
//! schema to find columns. URLs are namespaced as `/{schema}/{table}` and
//! `/{schema}/{table}/{pk}`, in the style of Django admin's `/{app}/{model}/`.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use serde_json::Value as JsonValue;
use sqlx::postgres::PgPool;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub struct Admin {
    pool: PgPool,
    /// Keyed by `(schema, name)` so two schemas can have same-named tables.
    /// `BTreeMap` ordering naturally groups by schema in the index page.
    tables: BTreeMap<(String, String), TableConfig>,
    prefix: String,
}

/// Internal handler state — a normalized prefix plus the admin config.
struct AdminState {
    admin: Admin,
}

#[derive(Default, Clone)]
pub struct TableConfig {
    display_name: Option<String>,
    searchable: Vec<String>,
    page_size: Option<i64>,
}

impl TableConfig {
    pub fn display_name(mut self, name: impl Into<String>) -> Self {
        self.display_name = Some(name.into());
        self
    }

    pub fn searchable<I, S>(mut self, cols: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.searchable = cols.into_iter().map(Into::into).collect();
        self
    }

    pub fn page_size(mut self, n: i64) -> Self {
        self.page_size = Some(n);
        self
    }
}

impl Admin {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            tables: BTreeMap::new(),
            prefix: "/admin".to_string(),
        }
    }

    /// Register a table by `(schema, name)`. The closure receives a default
    /// `TableConfig` and returns the configured one.
    pub fn table<F>(
        mut self,
        schema: impl Into<String>,
        name: impl Into<String>,
        configure: F,
    ) -> Self
    where
        F: FnOnce(TableConfig) -> TableConfig,
    {
        self.tables.insert(
            (schema.into(), name.into()),
            configure(TableConfig::default()),
        );
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
            .route("/{schema}/{table}", get(list))
            .route("/{schema}/{table}/{pk}", get(detail))
            .with_state(state)
    }
}

/// Strip a trailing slash so we can `format!("{prefix}/...")` cleanly.
/// Empty input becomes `""` (mounted at root).
fn normalize_prefix(p: &str) -> String {
    let trimmed = p.trim_end_matches('/');
    trimmed.to_string()
}

// ---------------------------------------------------------------------------
// Schema introspection
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
#[allow(dead_code)] // data_type / is_nullable will be consumed once edit forms land.
struct ColumnMeta {
    name: String,
    data_type: String,
    is_nullable: bool,
}

#[derive(Debug)]
struct TableSchema {
    columns: Vec<ColumnMeta>,
    primary_key: Option<String>,
}

async fn introspect(pool: &PgPool, schema: &str, table: &str) -> Result<TableSchema, sqlx::Error> {
    let columns = sqlx::query_as::<_, (String, String, String)>(
        r"
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
        ",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(name, data_type, is_nullable)| ColumnMeta {
        name,
        data_type,
        is_nullable: is_nullable == "YES",
    })
    .collect::<Vec<_>>();

    // Primary key: single-column only for the sketch. Build a fully-qualified
    // `"schema"."table"` string for `regclass` so it doesn't depend on the
    // session search_path.
    let qualified = format!("{}.{}", quote_ident(schema), quote_ident(table));
    let primary_key: Option<(String,)> = sqlx::query_as(
        r"
        SELECT a.attname::text
        FROM   pg_index i
        JOIN   pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE  i.indrelid = ($1::text)::regclass AND i.indisprimary
        LIMIT  1
        ",
    )
    .bind(&qualified)
    .fetch_optional(pool)
    .await?;

    Ok(TableSchema {
        columns,
        primary_key: primary_key.map(|(s,)| s),
    })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
struct ListQuery {
    q: Option<String>,
    page: Option<i64>,
}

async fn index(State(state): State<Arc<AdminState>>) -> Html<String> {
    let admin = &state.admin;
    let mut body = String::from("<h1>Admin</h1>");

    // BTreeMap iteration is sorted by `(schema, name)`, so we can group by
    // schema with a single pass.
    let mut current_schema: Option<&str> = None;
    for ((schema, name), cfg) in &admin.tables {
        if current_schema != Some(schema.as_str()) {
            if current_schema.is_some() {
                body.push_str("</ul>");
            }
            body.push_str(&format!("<h2>{}</h2><ul>", html_escape(schema)));
            current_schema = Some(schema.as_str());
        }
        let label = cfg.display_name.as_deref().unwrap_or(name);
        body.push_str(&format!(
            r#"<li><a href="{prefix}/{schema}/{name}">{label}</a></li>"#,
            prefix = html_escape(&admin.prefix),
            schema = html_escape(schema),
            name = html_escape(name),
            label = html_escape(label),
        ));
    }
    if current_schema.is_some() {
        body.push_str("</ul>");
    }
    Html(layout("Admin", &body))
}

async fn list(
    State(state): State<Arc<AdminState>>,
    Path((schema_name, table)): Path<(String, String)>,
    Query(q): Query<ListQuery>,
) -> Result<Html<String>, AdminError> {
    let admin = &state.admin;
    let key = (schema_name.clone(), table.clone());
    let cfg = admin
        .tables
        .get(&key)
        .ok_or_else(|| AdminError::UnknownTable(format!("{schema_name}.{table}")))?;
    let schema = introspect(&admin.pool, &schema_name, &table).await?;

    let page = q.page.unwrap_or(0).max(0);
    let page_size = cfg.page_size.unwrap_or(50).clamp(1, 500);
    let offset = page * page_size;

    // Whitelist the table identity by checking it exists in our config (already
    // done above) and quote schema + table with format!. Same for the pk in
    // ORDER BY.
    let pk = schema.primary_key.as_deref().unwrap_or("ctid");

    // Build search WHERE clause if applicable.
    let (where_sql, search_param) = match (&q.q, cfg.searchable.is_empty()) {
        (Some(needle), false) if !needle.is_empty() => {
            let conds: Vec<String> = cfg
                .searchable
                .iter()
                .filter(|c| schema.columns.iter().any(|col| &col.name == *c))
                .map(|c| format!("{} ILIKE $1", quote_ident(c)))
                .collect();
            if conds.is_empty() {
                ("".to_string(), None)
            } else {
                (
                    format!("WHERE {}", conds.join(" OR ")),
                    Some(format!("%{needle}%")),
                )
            }
        }
        _ => ("".to_string(), None),
    };

    let sql = format!(
        "SELECT row_to_json(t) FROM {sch}.{tbl} t {where_sql} ORDER BY {pk} LIMIT {limit} OFFSET {offset}",
        sch = quote_ident(&schema_name),
        tbl = quote_ident(&table),
        where_sql = where_sql,
        pk = quote_ident(pk),
        limit = page_size,
        offset = offset,
    );

    let mut query = sqlx::query_scalar::<_, JsonValue>(&sql);
    if let Some(s) = &search_param {
        query = query.bind(s);
    }
    let rows = query.fetch_all(&admin.pool).await?;

    Ok(Html(render_list(
        &admin.prefix,
        &schema_name,
        &table,
        cfg,
        &schema,
        &rows,
        page,
        &q.q,
    )))
}

async fn detail(
    State(state): State<Arc<AdminState>>,
    Path((schema_name, table, pk_value)): Path<(String, String, String)>,
) -> Result<Html<String>, AdminError> {
    let admin = &state.admin;
    let key = (schema_name.clone(), table.clone());
    let _cfg = admin
        .tables
        .get(&key)
        .ok_or_else(|| AdminError::UnknownTable(format!("{schema_name}.{table}")))?;
    let schema = introspect(&admin.pool, &schema_name, &table).await?;
    let pk = schema
        .primary_key
        .as_deref()
        .ok_or(AdminError::NoPrimaryKey)?;

    let sql = format!(
        "SELECT row_to_json(t) FROM {sch}.{tbl} t WHERE {pk}::text = $1",
        sch = quote_ident(&schema_name),
        tbl = quote_ident(&table),
        pk = quote_ident(pk),
    );
    let row: Option<JsonValue> = sqlx::query_scalar(&sql)
        .bind(&pk_value)
        .fetch_optional(&admin.pool)
        .await?;

    match row {
        Some(row) => Ok(Html(render_detail(
            &admin.prefix,
            &schema_name,
            &table,
            &schema,
            &row,
        ))),
        None => Err(AdminError::NotFound),
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)] // sketch: a request-context struct is more ceremony than value here.
fn render_list(
    prefix: &str,
    schema_name: &str,
    table: &str,
    cfg: &TableConfig,
    schema: &TableSchema,
    rows: &[JsonValue],
    page: i64,
    needle: &Option<String>,
) -> String {
    let label = cfg.display_name.as_deref().unwrap_or(table);
    let pk = schema.primary_key.as_deref();

    let mut body = format!(
        r#"<p><a href="{prefix}">← admin</a></p><h1>{schema}.{label}</h1>"#,
        prefix = html_escape(prefix),
        schema = html_escape(schema_name),
        label = html_escape(label),
    );

    if !cfg.searchable.is_empty() {
        let val = needle.as_deref().unwrap_or("");
        body.push_str(&format!(
            r#"<form method="get"><input name="q" value="{}" placeholder="search…"><button>go</button></form>"#,
            html_escape(val)
        ));
    }

    body.push_str("<table border=1 cellpadding=4><thead><tr>");
    for col in &schema.columns {
        body.push_str(&format!("<th>{}</th>", html_escape(&col.name)));
    }
    body.push_str("</tr></thead><tbody>");

    for row in rows {
        body.push_str("<tr>");
        for col in &schema.columns {
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
                    r#"<td><a href="{prefix}/{schema}/{tbl}/{pk}">{cell}</a></td>"#,
                    prefix = html_escape(prefix),
                    schema = html_escape(schema_name),
                    tbl = html_escape(table),
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
    schema_name: &str,
    table: &str,
    schema: &TableSchema,
    row: &JsonValue,
) -> String {
    let mut body = format!(
        r#"<p><a href="{prefix}/{schema}/{tbl}">← {schema}.{tbl}</a></p><h1>{schema}.{tbl} detail</h1><table border=1 cellpadding=4>"#,
        prefix = html_escape(prefix),
        schema = html_escape(schema_name),
        tbl = html_escape(table),
    );
    for col in &schema.columns {
        let cell = row.get(&col.name).map(json_cell).unwrap_or_default();
        body.push_str(&format!(
            "<tr><th align=left>{}</th><td>{}</td></tr>",
            html_escape(&col.name),
            cell
        ));
    }
    body.push_str("</table>");
    layout(&format!("{schema_name}.{table} detail"), &body)
}

fn layout(title: &str, body: &str) -> String {
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>{title}</title>
<style>body{{font:14px/1.4 system-ui;margin:2rem;max-width:1100px}}
table{{border-collapse:collapse}}th,td{{vertical-align:top}}
a{{color:#0366d6}}</style></head><body>{body}</body></html>"#,
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

fn quote_ident(s: &str) -> String {
    // Postgres identifier quoting: double quotes, double any embedded quotes.
    // The caller should have already validated the identifier against the
    // known schema.
    format!("\"{}\"", s.replace('"', "\"\""))
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

#[derive(Debug)]
enum AdminError {
    UnknownTable(String),
    NoPrimaryKey,
    NotFound,
    Sqlx(sqlx::Error),
}

impl From<sqlx::Error> for AdminError {
    fn from(e: sqlx::Error) -> Self {
        AdminError::Sqlx(e)
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
            AdminError::Sqlx(e) => {
                tracing::error!(error = ?e, "axum-admin sqlx error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "database error".to_string(),
                )
                    .into_response()
            }
        }
    }
}
