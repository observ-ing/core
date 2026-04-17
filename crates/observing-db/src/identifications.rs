use crate::types::{IdentificationRow, UpsertIdentificationParams};
use sqlx::PgPool;
use std::collections::HashMap;

/// Upsert an identification record and refresh the community ID materialized view.
///
/// NOTE: Must take `&PgPool` because `REFRESH MATERIALIZED VIEW CONCURRENTLY`
/// cannot be executed within a transaction block.
pub async fn upsert(pool: &PgPool, p: &UpsertIdentificationParams) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO identifications (
            uri, cid, did, subject_uri, subject_cid, scientific_name,
            taxon_rank, taxon_id, is_agreement, date_identified,
            vernacular_name, kingdom, phylum, class, "order", family, genus
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (uri) DO UPDATE SET
            cid = $2,
            scientific_name = $6,
            taxon_rank = COALESCE($7, identifications.taxon_rank),
            taxon_id = COALESCE($8, identifications.taxon_id),
            is_agreement = $9,
            vernacular_name = COALESCE($11, identifications.vernacular_name),
            kingdom = COALESCE($12, identifications.kingdom),
            phylum = COALESCE($13, identifications.phylum),
            class = COALESCE($14, identifications.class),
            "order" = COALESCE($15, identifications."order"),
            family = COALESCE($16, identifications.family),
            genus = COALESCE($17, identifications.genus),
            indexed_at = NOW()
        "#,
        p.uri,
        p.cid,
        p.did,
        p.subject_uri,
        p.subject_cid,
        p.scientific_name,
        p.taxon_rank as _,
        p.taxon_id as _,
        p.is_agreement,
        chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(p.date_identified, chrono::Utc),
        p.vernacular_name as _,
        p.kingdom as _,
        p.phylum as _,
        p.class as _,
        p.order as _,
        p.family as _,
        p.genus as _,
    )
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
            identification_verification_status, type_status, is_agreement, date_identified,
            vernacular_name, kingdom, phylum, class, "order" as order_, family, genus
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
            identification_verification_status, type_status, is_agreement, date_identified,
            vernacular_name, kingdom, phylum, class, "order" as order_, family, genus
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
