use crate::types::{IdentificationRow, UpsertIdentificationParams};
use sqlx::PgPool;
use std::collections::HashMap;

/// Upsert an identification record and refresh the community ID materialized view.
///
/// NOTE: Must take `&PgPool` because `REFRESH MATERIALIZED VIEW CONCURRENTLY`
/// cannot be executed within a transaction block.
///
/// Uses the dynamic query API rather than the `query!` macro so the new
/// `accepted_taxon_key` column doesn't require regenerating the offline
/// sqlx-prepare cache.
pub async fn upsert(pool: &PgPool, p: &UpsertIdentificationParams) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO identifications (
            uri, cid, did, subject_uri, subject_cid, scientific_name,
            taxon_rank, taxon_id, date_identified, kingdom, accepted_taxon_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (uri) DO UPDATE SET
            cid = $2,
            scientific_name = $6,
            taxon_rank = COALESCE($7, identifications.taxon_rank),
            taxon_id = COALESCE($8, identifications.taxon_id),
            kingdom = COALESCE($10, identifications.kingdom),
            accepted_taxon_key = COALESCE($11, identifications.accepted_taxon_key),
            indexed_at = NOW()
        "#,
    )
    .bind(&p.uri)
    .bind(&p.cid)
    .bind(&p.did)
    .bind(&p.subject_uri)
    .bind(&p.subject_cid)
    .bind(&p.scientific_name)
    .bind(&p.taxon_rank)
    .bind(&p.taxon_id)
    .bind(p.date_identified)
    .bind(&p.kingdom)
    .bind(p.accepted_taxon_key)
    .execute(pool)
    .await?;

    refresh_community_ids(pool).await?;
    Ok(())
}

/// Delete an identification and refresh the community ID materialized view.
///
/// NOTE: Must take `&PgPool` because `REFRESH MATERIALIZED VIEW CONCURRENTLY`
/// cannot be executed within a transaction block.
pub async fn delete(pool: &PgPool, uri: &str) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM identifications WHERE uri = $1", uri)
        .execute(pool)
        .await?;
    refresh_community_ids(pool).await?;
    Ok(())
}

/// Get all identifications for an occurrence
pub async fn get_for_occurrence(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
) -> Result<Vec<IdentificationRow>, sqlx::Error> {
    sqlx::query_as!(
        IdentificationRow,
        r#"
        SELECT
            uri, cid, did, subject_uri, subject_cid, scientific_name,
            taxon_rank, identification_qualifier, taxon_id,
            identification_verification_status, type_status, date_identified,
            kingdom, phylum, class, "order" as order_, family, genus
        FROM identifications
        WHERE subject_uri = $1
        ORDER BY date_identified DESC
        "#,
        occurrence_uri,
    )
    .fetch_all(executor)
    .await
}

/// Get identifications for multiple occurrences (batch)
pub async fn get_for_subjects_batch(
    executor: impl sqlx::PgExecutor<'_>,
    uris: &[String],
) -> Result<HashMap<String, Vec<IdentificationRow>>, sqlx::Error> {
    if uris.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query_as!(
        IdentificationRow,
        r#"
        SELECT
            uri, cid, did, subject_uri, subject_cid, scientific_name,
            taxon_rank, identification_qualifier, taxon_id,
            identification_verification_status, type_status, date_identified,
            kingdom, phylum, class, "order" as order_, family, genus
        FROM identifications
        WHERE subject_uri = ANY($1)
        ORDER BY subject_uri, date_identified DESC
        "#,
        uris,
    )
    .fetch_all(executor)
    .await?;

    let mut map: HashMap<String, Vec<IdentificationRow>> = HashMap::new();
    for row in rows {
        let key = row.subject_uri.clone();
        map.entry(key).or_default().push(row);
    }
    Ok(map)
}

/// Get the community ID (winning taxon) for an occurrence
pub async fn get_community_id(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT scientific_name
        FROM community_ids
        WHERE occurrence_uri = $1
        ORDER BY id_count DESC
        LIMIT 1
        "#,
        occurrence_uri,
    )
    .fetch_optional(executor)
    .await?;
    Ok(row.and_then(|r| r.scientific_name))
}

/// Get community IDs (winning taxon) for multiple occurrences (batch)
pub async fn get_community_ids_for_occurrences(
    executor: impl sqlx::PgExecutor<'_>,
    uris: &[String],
) -> Result<HashMap<String, String>, sqlx::Error> {
    if uris.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT DISTINCT ON (occurrence_uri)
            occurrence_uri as "occurrence_uri!", scientific_name
        FROM community_ids
        WHERE occurrence_uri = ANY($1)
        ORDER BY occurrence_uri, id_count DESC
        "#,
        uris,
    )
    .fetch_all(executor)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|r| Some((r.occurrence_uri, r.scientific_name?)))
        .collect())
}

/// Refresh the community IDs materialized view
pub async fn refresh_community_ids(executor: impl sqlx::PgExecutor<'_>) -> Result<(), sqlx::Error> {
    sqlx::query!("REFRESH MATERIALIZED VIEW CONCURRENTLY community_ids")
        .execute(executor)
        .await?;
    Ok(())
}
