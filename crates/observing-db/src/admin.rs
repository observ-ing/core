//! Lexicon-scoped admin operations: count, list, and delete records by NSID.
//!
//! Each table stores records for one or more lexicon NSIDs. Rows are filtered
//! by URI prefix (`at://<did>/<nsid>/<rkey>`) because some tables (notably
//! `occurrences`) hold records from both the current `bio.lexicons.*` namespace
//! and the legacy `ing.observ.*` namespace during the lexicons.bio migration.
//!
//! Uses runtime `sqlx::query` rather than the compile-time macros because the
//! table is selected dynamically via NSID dispatch. NSIDs and table names are
//! drawn from the `KNOWN_COLLECTIONS` allowlist — never user input — so no
//! injection risk.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};

/// Metadata for a lexicon NSID the admin interface can operate on.
pub struct KnownCollection {
    pub nsid: &'static str,
    pub table: &'static str,
    /// Tables whose rows are deleted via foreign-key cascade when a parent
    /// `occurrences` row is removed. Empty for non-parent tables.
    pub cascades_to: &'static [&'static str],
}

pub const KNOWN_COLLECTIONS: &[KnownCollection] = &[
    KnownCollection {
        nsid: "bio.lexicons.temp.occurrence",
        table: "occurrences",
        cascades_to: &[
            "identifications",
            "comments",
            "likes",
            "interactions",
            "occurrence_observers",
        ],
    },
    KnownCollection {
        nsid: "bio.lexicons.temp.identification",
        table: "identifications",
        cascades_to: &[],
    },
    KnownCollection {
        nsid: "ing.observ.temp.occurrence",
        table: "occurrences",
        cascades_to: &[
            "identifications",
            "comments",
            "likes",
            "interactions",
            "occurrence_observers",
        ],
    },
    KnownCollection {
        nsid: "ing.observ.temp.comment",
        table: "comments",
        cascades_to: &[],
    },
    KnownCollection {
        nsid: "ing.observ.temp.like",
        table: "likes",
        cascades_to: &[],
    },
    KnownCollection {
        nsid: "ing.observ.temp.interaction",
        table: "interactions",
        cascades_to: &[],
    },
];

pub fn lookup(nsid: &str) -> Option<&'static KnownCollection> {
    KNOWN_COLLECTIONS.iter().find(|c| c.nsid == nsid)
}

#[derive(Debug, Serialize)]
pub struct CollectionStats {
    pub nsid: String,
    pub table: String,
    pub count: i64,
    pub unique_dids: i64,
    pub oldest_indexed_at: Option<DateTime<Utc>>,
    pub newest_indexed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct RecordSummary {
    pub uri: String,
    pub did: String,
    pub cid: String,
    pub indexed_at: Option<DateTime<Utc>>,
}

/// Count rows belonging to a given NSID. Returns 0 for unknown NSIDs.
pub async fn count(pool: &PgPool, nsid: &str) -> Result<i64, sqlx::Error> {
    let Some(meta) = lookup(nsid) else {
        return Ok(0);
    };
    let sql = format!("SELECT COUNT(*) FROM {} WHERE uri LIKE $1", meta.table);
    let count: i64 = sqlx::query_scalar(&sql)
        .bind(format!("at://%/{}/%", nsid))
        .fetch_one(pool)
        .await?;
    Ok(count)
}

/// Full stats for one collection: count, unique DIDs, oldest/newest indexed_at.
pub async fn stats(pool: &PgPool, nsid: &str) -> Result<Option<CollectionStats>, sqlx::Error> {
    let Some(meta) = lookup(nsid) else {
        return Ok(None);
    };
    // The `likes` table uses TIMESTAMP(3), not TIMESTAMPTZ. Read as naive and
    // convert; PostgreSQL's MIN/MAX return typed values that sqlx maps into
    // chrono::NaiveDateTime for TIMESTAMP and DateTime<Utc> for TIMESTAMPTZ.
    let sql = format!(
        "SELECT
            COUNT(*) AS count,
            COUNT(DISTINCT did) AS unique_dids,
            MIN(indexed_at) AS oldest,
            MAX(indexed_at) AS newest
        FROM {}
        WHERE uri LIKE $1",
        meta.table
    );
    let row = sqlx::query(&sql)
        .bind(format!("at://%/{}/%", nsid))
        .fetch_one(pool)
        .await?;

    let count: i64 = row.try_get("count")?;
    let unique_dids: i64 = row.try_get("unique_dids")?;
    let (oldest, newest) = if meta.table == "likes" {
        let o: Option<chrono::NaiveDateTime> = row.try_get("oldest")?;
        let n: Option<chrono::NaiveDateTime> = row.try_get("newest")?;
        (
            o.map(|d| DateTime::<Utc>::from_naive_utc_and_offset(d, Utc)),
            n.map(|d| DateTime::<Utc>::from_naive_utc_and_offset(d, Utc)),
        )
    } else {
        (row.try_get("oldest")?, row.try_get("newest")?)
    };

    Ok(Some(CollectionStats {
        nsid: nsid.to_string(),
        table: meta.table.to_string(),
        count,
        unique_dids,
        oldest_indexed_at: oldest,
        newest_indexed_at: newest,
    }))
}

/// List record summaries for a collection, optionally filtered to a single DID.
/// Ordered by `indexed_at DESC` (most recently ingested first).
pub async fn list_records(
    pool: &PgPool,
    nsid: &str,
    did: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<RecordSummary>, sqlx::Error> {
    let Some(meta) = lookup(nsid) else {
        return Ok(Vec::new());
    };
    let did_filter = did.unwrap_or("");
    let use_did = did.is_some();

    let sql = format!(
        "SELECT uri, did, cid, indexed_at
         FROM {}
         WHERE uri LIKE $1
           AND ($2::bool = FALSE OR did = $3)
         ORDER BY indexed_at DESC
         LIMIT $4 OFFSET $5",
        meta.table
    );

    let rows = sqlx::query(&sql)
        .bind(format!("at://%/{}/%", nsid))
        .bind(use_did)
        .bind(did_filter)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;

    let is_likes = meta.table == "likes";
    let mut summaries = Vec::with_capacity(rows.len());
    for row in rows {
        let indexed_at = if is_likes {
            let ts: Option<chrono::NaiveDateTime> = row.try_get("indexed_at")?;
            ts.map(|d| DateTime::<Utc>::from_naive_utc_and_offset(d, Utc))
        } else {
            row.try_get("indexed_at")?
        };
        summaries.push(RecordSummary {
            uri: row.try_get("uri")?,
            did: row.try_get("did")?,
            cid: row.try_get("cid")?,
            indexed_at,
        });
    }
    Ok(summaries)
}

/// Full-detail SELECT column list for a lexicon table, with PostGIS geometry
/// columns cast to WKT so `row_to_json` can serialize them.
fn record_detail_columns(table: &str) -> &'static str {
    match table {
        "occurrences" => {
            "uri, cid, did, scientific_name, event_date, \
             ST_AsText(location) AS location, coordinate_uncertainty_meters, \
             continent, country, country_code, state_province, county, \
             municipality, locality, water_body, verbatim_locality, \
             occurrence_remarks, associated_media, recorded_by, taxon_id, \
             taxon_rank, vernacular_name, kingdom, phylum, class, \"order\", \
             family, genus, created_at, indexed_at"
        }
        "identifications" => {
            "uri, cid, did, subject_uri, subject_cid, subject_index, \
             scientific_name, taxon_rank, identification_qualifier, taxon_id, \
             identification_verification_status, type_status, is_agreement, \
             date_identified, indexed_at, vernacular_name, kingdom, phylum, \
             class, \"order\", family, genus"
        }
        "comments" => {
            "uri, cid, did, subject_uri, subject_cid, body, reply_to_uri, \
             reply_to_cid, created_at, indexed_at"
        }
        "likes" => "uri, cid, did, subject_uri, subject_cid, created_at, indexed_at",
        "interactions" => {
            "uri, cid, did, subject_a_occurrence_uri, subject_a_occurrence_cid, \
             subject_a_subject_index, subject_a_taxon_name, subject_a_kingdom, \
             subject_b_occurrence_uri, subject_b_occurrence_cid, \
             subject_b_subject_index, subject_b_taxon_name, subject_b_kingdom, \
             interaction_type, direction, comment, created_at, indexed_at"
        }
        _ => "*",
    }
}

/// Fetch the full row for a single lexicon record, returned as a JSON object.
///
/// The URI must match the NSID's `at://<did>/<nsid>/<rkey>` pattern to prevent
/// reading rows of a different collection through an adjacent NSID's detail
/// endpoint.
pub async fn get_record(
    pool: &PgPool,
    nsid: &str,
    uri: &str,
) -> Result<Option<serde_json::Value>, sqlx::Error> {
    let Some(meta) = lookup(nsid) else {
        return Ok(None);
    };
    if !uri.starts_with("at://") || !uri.contains(&format!("/{}/", nsid)) {
        return Ok(None);
    }
    let cols = record_detail_columns(meta.table);
    let sql = format!(
        "SELECT row_to_json(t) FROM (SELECT {cols} FROM {table} WHERE uri = $1) t",
        table = meta.table,
    );
    let row: Option<(serde_json::Value,)> =
        sqlx::query_as(&sql).bind(uri).fetch_optional(pool).await?;
    Ok(row.map(|(v,)| v))
}

/// Metadata for a non-lexicon table the admin interface can browse read-only.
///
/// Unlike `KnownCollection` (lexicon-scoped records keyed by NSID), these are
/// internal tables. OAuth/session stores are intentionally excluded.
pub struct KnownTable {
    pub name: &'static str,
    /// Explicit allowlist of columns. Never `SELECT *`. Each entry is a
    /// `(select_expr, display_name)` pair — the expression is used in the
    /// SELECT clause (aliased to `display_name`) and the name is used as the
    /// JSON key and column header. Expressions are constants from this source
    /// file, never user input.
    pub columns: &'static [(&'static str, &'static str)],
    pub order_by: &'static str,
}

pub const KNOWN_TABLES: &[KnownTable] = &[
    KnownTable {
        name: "ingester_state",
        columns: &[
            ("key", "key"),
            ("value", "value"),
            ("updated_at", "updated_at"),
        ],
        order_by: "updated_at DESC NULLS LAST",
    },
    KnownTable {
        name: "occurrence_observers",
        columns: &[
            ("occurrence_uri", "occurrence_uri"),
            ("observer_did", "observer_did"),
            ("role", "role"),
            ("added_at", "added_at"),
        ],
        order_by: "added_at DESC NULLS LAST",
    },
    KnownTable {
        name: "occurrence_private_data",
        columns: &[
            ("uri", "uri"),
            ("ST_AsText(exact_location)", "exact_location"),
            ("geoprivacy", "geoprivacy"),
            ("effective_geoprivacy", "effective_geoprivacy"),
            ("created_at", "created_at"),
            ("updated_at", "updated_at"),
        ],
        order_by: "updated_at DESC NULLS LAST",
    },
    KnownTable {
        name: "sensitive_species",
        columns: &[
            ("scientific_name", "scientific_name"),
            ("kingdom", "kingdom"),
            ("geoprivacy", "geoprivacy"),
            ("reason", "reason"),
            ("source", "source"),
        ],
        order_by: "scientific_name",
    },
    KnownTable {
        name: "notifications",
        columns: &[
            ("id", "id"),
            ("recipient_did", "recipient_did"),
            ("actor_did", "actor_did"),
            ("kind", "kind"),
            ("subject_uri", "subject_uri"),
            ("reference_uri", "reference_uri"),
            ("read", "read"),
            ("created_at", "created_at"),
        ],
        order_by: "created_at DESC",
    },
    KnownTable {
        name: "community_ids",
        columns: &[
            ("occurrence_uri", "occurrence_uri"),
            ("subject_index", "subject_index"),
            ("scientific_name", "scientific_name"),
            ("kingdom", "kingdom"),
            ("id_count", "id_count"),
            ("agreement_count", "agreement_count"),
        ],
        order_by: "occurrence_uri",
    },
];

impl KnownTable {
    pub fn column_names(&self) -> Vec<&'static str> {
        self.columns.iter().map(|(_, name)| *name).collect()
    }
}

pub fn lookup_table(name: &str) -> Option<&'static KnownTable> {
    KNOWN_TABLES.iter().find(|t| t.name == name)
}

pub async fn table_count(pool: &PgPool, name: &str) -> Result<i64, sqlx::Error> {
    let Some(meta) = lookup_table(name) else {
        return Ok(0);
    };
    let sql = format!("SELECT COUNT(*) FROM {}", meta.name);
    sqlx::query_scalar(&sql).fetch_one(pool).await
}

/// List rows from an allowlisted non-lexicon table, returned as JSON objects.
///
/// Uses Postgres `row_to_json` so column-type handling (timestamps, booleans,
/// bigints, nullables) is done server-side — no per-type Rust decoding. The
/// table name and column list come from the `KNOWN_TABLES` allowlist, never
/// user input, so no injection risk.
pub async fn list_table_rows(
    pool: &PgPool,
    name: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let Some(meta) = lookup_table(name) else {
        return Ok(Vec::new());
    };
    let cols = meta
        .columns
        .iter()
        .map(|(expr, name)| format!("{expr} AS {name}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT row_to_json(t) AS row FROM (SELECT {} FROM {} ORDER BY {} LIMIT $1 OFFSET $2) t",
        cols, meta.name, meta.order_by,
    );
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(&sql)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(|(v,)| v).collect())
}

/// Delete all rows belonging to an NSID. Returns the number of rows affected.
/// Callers are responsible for guarding this with a confirmation token.
pub async fn delete_by_nsid(pool: &PgPool, nsid: &str) -> Result<u64, sqlx::Error> {
    let Some(meta) = lookup(nsid) else {
        return Ok(0);
    };
    let sql = format!("DELETE FROM {} WHERE uri LIKE $1", meta.table);
    let result = sqlx::query(&sql)
        .bind(format!("at://%/{}/%", nsid))
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}
