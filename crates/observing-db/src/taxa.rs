//! Read/write access for the `taxa` cache table.
//!
//! Backs the [`crate::taxonomy_resolver::Resolver`] orchestration layer.
//! Pure SQL — no external taxonomy source dependency.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, QueryBuilder};

/// One row of the `taxa` cache. Mirrors the schema from
/// `migrations/20260505100000_taxa_cache.sql`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq)]
pub struct TaxonRow {
    pub taxon_key: i64,
    pub scientific_name: String,
    pub authorship: Option<String>,
    pub rank: String,
    pub status: String,
    pub accepted_taxon_key: Option<i64>,
    pub parent_key: Option<i64>,

    pub kingdom: Option<String>,
    pub kingdom_key: Option<i64>,
    pub phylum: Option<String>,
    pub phylum_key: Option<i64>,
    pub class: Option<String>,
    pub class_key: Option<i64>,
    #[sqlx(rename = "order")]
    #[serde(rename = "order")]
    pub order_: Option<String>,
    pub order_key: Option<i64>,
    pub family: Option<String>,
    pub family_key: Option<i64>,
    pub genus: Option<String>,
    pub genus_key: Option<i64>,
    pub species: Option<String>,
    pub species_key: Option<i64>,

    pub vernacular_name: Option<String>,
    pub extinct: Option<bool>,
    pub fetched_at: DateTime<Utc>,
    pub source: String,
}

const SELECT_COLUMNS: &str = r#"taxon_key, scientific_name, authorship, rank, status,
    accepted_taxon_key, parent_key,
    kingdom, kingdom_key, phylum, phylum_key, class, class_key,
    "order", order_key, family, family_key, genus, genus_key,
    species, species_key,
    vernacular_name, extinct, fetched_at, source"#;

/// Look up a single row by GBIF usageKey.
pub async fn get_by_key(
    executor: impl sqlx::PgExecutor<'_>,
    taxon_key: i64,
) -> Result<Option<TaxonRow>, sqlx::Error> {
    let sql = format!("SELECT {SELECT_COLUMNS} FROM taxa WHERE taxon_key = $1");
    sqlx::query_as::<_, TaxonRow>(&sql)
        .bind(taxon_key)
        .fetch_optional(executor)
        .await
}

/// Look up a row by case-insensitive scientific name, optionally scoped by
/// kingdom to disambiguate cross-kingdom homonyms.
///
/// When multiple rows match (e.g. an accepted taxon plus a synonym sharing
/// the same name) the accepted one wins; ties beyond that fall back to the
/// lowest taxon_key for determinism.
pub async fn get_by_name(
    executor: impl sqlx::PgExecutor<'_>,
    scientific_name: &str,
    kingdom_hint: Option<&str>,
) -> Result<Option<TaxonRow>, sqlx::Error> {
    let sql = format!(
        r#"SELECT {SELECT_COLUMNS}
           FROM taxa
           WHERE LOWER(scientific_name) = LOWER($1)
             AND ($2::text IS NULL OR kingdom = $2)
           ORDER BY (status = 'ACCEPTED') DESC, taxon_key ASC
           LIMIT 1"#
    );
    sqlx::query_as::<_, TaxonRow>(&sql)
        .bind(scientific_name)
        .bind(kingdom_hint)
        .fetch_optional(executor)
        .await
}

/// Insert or refresh a batch of taxa rows. Conflicting `taxon_key` rows are
/// updated in place so concurrent resolves of the same name are safe and a
/// re-fetch overwrites stale ancestry data.
///
/// Dedupes the input by `taxon_key` (last entry wins) before issuing the
/// INSERT. Postgres rejects `ON CONFLICT DO UPDATE` when the same target
/// row appears twice in the values list, and GBIF's match payload often
/// includes the target taxon as both the `usage` and the tail of the
/// `classification` chain.
pub async fn upsert_many(
    executor: impl sqlx::PgExecutor<'_>,
    rows: &[TaxonRow],
) -> Result<(), sqlx::Error> {
    if rows.is_empty() {
        return Ok(());
    }

    let mut by_key: std::collections::HashMap<i64, &TaxonRow> =
        std::collections::HashMap::with_capacity(rows.len());
    for row in rows {
        by_key.insert(row.taxon_key, row);
    }
    let deduped: Vec<&TaxonRow> = by_key.into_values().collect();

    let mut qb = QueryBuilder::<Postgres>::new(
        r#"INSERT INTO taxa (
            taxon_key, scientific_name, authorship, rank, status,
            accepted_taxon_key, parent_key,
            kingdom, kingdom_key, phylum, phylum_key, class, class_key,
            "order", order_key, family, family_key, genus, genus_key,
            species, species_key,
            vernacular_name, extinct, fetched_at, source
        ) "#,
    );
    qb.push_values(&deduped, |mut b, row| {
        b.push_bind(row.taxon_key)
            .push_bind(&row.scientific_name)
            .push_bind(&row.authorship)
            .push_bind(&row.rank)
            .push_bind(&row.status)
            .push_bind(row.accepted_taxon_key)
            .push_bind(row.parent_key)
            .push_bind(&row.kingdom)
            .push_bind(row.kingdom_key)
            .push_bind(&row.phylum)
            .push_bind(row.phylum_key)
            .push_bind(&row.class)
            .push_bind(row.class_key)
            .push_bind(&row.order_)
            .push_bind(row.order_key)
            .push_bind(&row.family)
            .push_bind(row.family_key)
            .push_bind(&row.genus)
            .push_bind(row.genus_key)
            .push_bind(&row.species)
            .push_bind(row.species_key)
            .push_bind(&row.vernacular_name)
            .push_bind(row.extinct)
            .push_bind(row.fetched_at)
            .push_bind(&row.source);
    });
    qb.push(
        r#" ON CONFLICT (taxon_key) DO UPDATE SET
            scientific_name = EXCLUDED.scientific_name,
            authorship = EXCLUDED.authorship,
            rank = EXCLUDED.rank,
            status = EXCLUDED.status,
            accepted_taxon_key = EXCLUDED.accepted_taxon_key,
            parent_key = EXCLUDED.parent_key,
            kingdom = EXCLUDED.kingdom,
            kingdom_key = EXCLUDED.kingdom_key,
            phylum = EXCLUDED.phylum,
            phylum_key = EXCLUDED.phylum_key,
            class = EXCLUDED.class,
            class_key = EXCLUDED.class_key,
            "order" = EXCLUDED."order",
            order_key = EXCLUDED.order_key,
            family = EXCLUDED.family,
            family_key = EXCLUDED.family_key,
            genus = EXCLUDED.genus,
            genus_key = EXCLUDED.genus_key,
            species = EXCLUDED.species,
            species_key = EXCLUDED.species_key,
            vernacular_name = EXCLUDED.vernacular_name,
            extinct = EXCLUDED.extinct,
            fetched_at = EXCLUDED.fetched_at,
            source = EXCLUDED.source"#,
    );

    qb.build().execute(executor).await?;
    Ok(())
}
