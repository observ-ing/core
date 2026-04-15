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
