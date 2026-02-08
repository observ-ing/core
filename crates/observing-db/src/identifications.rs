use crate::types::{IdentificationRow, SubjectInfo, UpsertIdentificationParams};
use sqlx::PgPool;

/// Upsert an identification record and refresh the community ID materialized view
pub async fn upsert(pool: &PgPool, p: &UpsertIdentificationParams) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO identifications (
            uri, cid, did, subject_uri, subject_cid, subject_index, scientific_name,
            taxon_rank, identification_remarks, taxon_id, is_agreement, date_identified,
            vernacular_name, kingdom, phylum, class, "order", family, genus, confidence
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (uri) DO UPDATE SET
            cid = $2,
            subject_index = $6,
            scientific_name = $7,
            taxon_rank = $8,
            identification_remarks = $9,
            taxon_id = $10,
            is_agreement = $11,
            vernacular_name = $13,
            kingdom = $14,
            phylum = $15,
            class = $16,
            "order" = $17,
            family = $18,
            genus = $19,
            confidence = $20,
            indexed_at = NOW()
        "#,
        p.uri,
        p.cid,
        p.did,
        p.subject_uri,
        p.subject_cid,
        p.subject_index,
        p.scientific_name,
        p.taxon_rank as _,
        p.identification_remarks as _,
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
        p.confidence as _,
    )
    .execute(pool)
    .await?;

    refresh_community_ids(pool).await?;
    Ok(())
}

/// Delete an identification and refresh the community ID materialized view
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
    sqlx::query_as::<_, IdentificationRow>(
        r#"
        SELECT
            uri, cid, did, subject_uri, subject_cid, subject_index, scientific_name,
            taxon_rank, identification_qualifier, taxon_id, identification_remarks,
            identification_verification_status, type_status, is_agreement, date_identified,
            vernacular_name, kingdom, phylum, class, "order", family, genus, confidence
        FROM identifications
        WHERE subject_uri = $1
        ORDER BY subject_index, date_identified DESC
        "#,
    )
    .bind(occurrence_uri)
    .fetch_all(executor)
    .await
}

/// Get identifications for a specific subject within an occurrence
pub async fn get_for_subject(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    subject_index: i32,
) -> Result<Vec<IdentificationRow>, sqlx::Error> {
    sqlx::query_as::<_, IdentificationRow>(
        r#"
        SELECT
            uri, cid, did, subject_uri, subject_cid, subject_index, scientific_name,
            taxon_rank, identification_qualifier, taxon_id, identification_remarks,
            identification_verification_status, type_status, is_agreement, date_identified,
            vernacular_name, kingdom, phylum, class, "order", family, genus, confidence
        FROM identifications
        WHERE subject_uri = $1 AND subject_index = $2
        ORDER BY date_identified DESC
        "#,
    )
    .bind(occurrence_uri)
    .bind(subject_index)
    .fetch_all(executor)
    .await
}

/// Get subject info (aggregated) for an occurrence
pub async fn get_subjects(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
) -> Result<Vec<SubjectInfo>, sqlx::Error> {
    sqlx::query_as::<_, SubjectInfo>(
        r#"
        SELECT
            subject_index,
            COUNT(*) as identification_count,
            MAX(date_identified) as latest_identification
        FROM identifications
        WHERE subject_uri = $1
        GROUP BY subject_index
        ORDER BY subject_index
        "#,
    )
    .bind(occurrence_uri)
    .fetch_all(executor)
    .await
}

/// Get the community ID (winning taxon) for an occurrence/subject
pub async fn get_community_id(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    subject_index: i32,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT scientific_name
        FROM community_ids
        WHERE occurrence_uri = $1 AND subject_index = $2
        ORDER BY id_count DESC
        LIMIT 1
        "#,
        occurrence_uri,
        subject_index,
    )
    .fetch_optional(executor)
    .await?;
    Ok(row.and_then(|r| r.scientific_name))
}

/// Refresh the community IDs materialized view
pub async fn refresh_community_ids(executor: impl sqlx::PgExecutor<'_>) -> Result<(), sqlx::Error> {
    sqlx::query!("REFRESH MATERIALIZED VIEW CONCURRENTLY community_ids")
        .execute(executor)
        .await?;
    Ok(())
}
