//! Postgres/sqlx [`TableSource`] plugin.
//!
//! [`PgTable`] is one registered table, served read-only over a `PgPool`. It
//! introspects columns and the primary key from `information_schema` /
//! `pg_catalog` at request time, so no per-table column config is needed.
//!
//! This is the reference plugin: the rest of `axum-admin` knows nothing about
//! SQL. Swap it out, or register `PgTable`s alongside other `TableSource`
//! implementations.

use async_trait::async_trait;
use serde_json::Value as JsonValue;
use sqlx::postgres::PgPool;

use crate::{AdminError, Column, ListQuery, Row, TableMeta, TableSource};

/// A single Postgres table, addressed by `(schema, name)`, served read-only.
///
/// Cheap to construct and clone the pool into — `PgPool` is an `Arc`
/// internally, so registering many tables against one pool is fine.
pub struct PgTable {
    pool: PgPool,
    schema: String,
    name: String,
    display_name: Option<String>,
    searchable: Vec<String>,
    page_size: i64,
}

impl PgTable {
    /// Register table `name` in `schema`, served over `pool`.
    pub fn new(pool: PgPool, schema: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            pool,
            schema: schema.into(),
            name: name.into(),
            display_name: None,
            searchable: Vec::new(),
            page_size: 50,
        }
    }

    /// Override the human-facing label shown in the index and headings.
    pub fn display_name(mut self, name: impl Into<String>) -> Self {
        self.display_name = Some(name.into());
        self
    }

    /// Columns to match (case-insensitively) against the `?q=` search needle.
    /// Names not present on the table are ignored at query time.
    pub fn searchable<I, S>(mut self, cols: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.searchable = cols.into_iter().map(Into::into).collect();
        self
    }

    /// Rows per page (clamped to `1..=500` at query time). Defaults to 50.
    pub fn page_size(mut self, n: i64) -> Self {
        self.page_size = n;
        self
    }
}

#[async_trait]
impl TableSource for PgTable {
    fn group(&self) -> &str {
        &self.schema
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn display_name(&self) -> &str {
        self.display_name.as_deref().unwrap_or(&self.name)
    }

    fn datastore(&self) -> &str {
        "postgres"
    }

    fn searchable(&self) -> bool {
        !self.searchable.is_empty()
    }

    async fn meta(&self) -> Result<TableMeta, AdminError> {
        let columns = sqlx::query_as::<_, (String, String, String)>(
            r"
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
            ",
        )
        .bind(&self.schema)
        .bind(&self.name)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|(name, data_type, is_nullable)| Column {
            name,
            data_type,
            nullable: is_nullable == "YES",
        })
        .collect::<Vec<_>>();

        // Primary key: single-column only for the sketch. Build a
        // fully-qualified `"schema"."table"` string for `regclass` so it
        // doesn't depend on the session search_path.
        let qualified = format!("{}.{}", quote_ident(&self.schema), quote_ident(&self.name));
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
        .fetch_optional(&self.pool)
        .await?;

        Ok(TableMeta {
            columns,
            primary_key: primary_key.map(|(s,)| s),
        })
    }

    async fn list(&self, meta: &TableMeta, query: &ListQuery) -> Result<Vec<Row>, AdminError> {
        let page = query.page.unwrap_or(0).max(0);
        let page_size = self.page_size.clamp(1, 500);
        let offset = page * page_size;

        // `ORDER BY` needs a stable key; fall back to `ctid` when there's no
        // primary key.
        let pk = meta.primary_key.as_deref().unwrap_or("ctid");

        // Build the search WHERE clause if applicable. Only columns that
        // actually exist on the table are matched.
        let (where_sql, search_param) = match &query.q {
            Some(needle) if !needle.is_empty() && !self.searchable.is_empty() => {
                let conds: Vec<String> = self
                    .searchable
                    .iter()
                    .filter(|c| meta.columns.iter().any(|col| &col.name == *c))
                    .map(|c| format!("{} ILIKE $1", quote_ident(c)))
                    .collect();
                if conds.is_empty() {
                    (String::new(), None)
                } else {
                    (
                        format!("WHERE {}", conds.join(" OR ")),
                        Some(format!("%{needle}%")),
                    )
                }
            }
            _ => (String::new(), None),
        };

        let sql = format!(
            "SELECT row_to_json(t) FROM {sch}.{tbl} t {where_sql} ORDER BY {pk} LIMIT {limit} OFFSET {offset}",
            sch = quote_ident(&self.schema),
            tbl = quote_ident(&self.name),
            pk = quote_ident(pk),
            limit = page_size,
            offset = offset,
        );

        // SQL is built from `quote_ident`-quoted identifiers (table whitelisted
        // by being registered, columns checked against `meta`) with all values
        // bound via `$1`, so the dynamic string is safe to assert.
        let mut q = sqlx::query_scalar::<_, JsonValue>(sqlx::AssertSqlSafe(sql));
        if let Some(s) = &search_param {
            q = q.bind(s);
        }
        Ok(q.fetch_all(&self.pool).await?)
    }

    async fn get(&self, meta: &TableMeta, pk: &str) -> Result<Option<Row>, AdminError> {
        let pk_col = meta
            .primary_key
            .as_deref()
            .ok_or(AdminError::NoPrimaryKey)?;

        let sql = format!(
            "SELECT row_to_json(t) FROM {sch}.{tbl} t WHERE {pk}::text = $1",
            sch = quote_ident(&self.schema),
            tbl = quote_ident(&self.name),
            pk = quote_ident(pk_col),
        );
        // Identifiers are `quote_ident`-quoted and the pk value is bound via `$1`.
        let row: Option<JsonValue> = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
            .bind(pk)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row)
    }
}

impl From<sqlx::Error> for AdminError {
    fn from(e: sqlx::Error) -> Self {
        AdminError::backend(e)
    }
}

/// Postgres identifier quoting: double quotes, double any embedded quotes.
/// Callers should already have validated the identifier against the known
/// schema (registered table name, or a column from [`TableMeta`]).
fn quote_ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}
