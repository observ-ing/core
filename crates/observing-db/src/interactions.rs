use crate::types::{InteractionRow, UpsertInteractionParams};

/// Upsert an interaction record
pub async fn upsert(
    executor: impl sqlx::PgExecutor<'_>,
    p: &UpsertInteractionParams,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO interactions (
            uri, cid, did,
            subject_a_occurrence_uri, subject_a_occurrence_cid, subject_a_subject_index,
            subject_a_taxon_name, subject_a_kingdom,
            subject_b_occurrence_uri, subject_b_occurrence_cid, subject_b_subject_index,
            subject_b_taxon_name, subject_b_kingdom,
            interaction_type, direction, confidence, comment, created_at, indexed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
        ON CONFLICT (uri) DO UPDATE SET
            cid = EXCLUDED.cid,
            subject_a_occurrence_uri = EXCLUDED.subject_a_occurrence_uri,
            subject_a_occurrence_cid = EXCLUDED.subject_a_occurrence_cid,
            subject_a_subject_index = EXCLUDED.subject_a_subject_index,
            subject_a_taxon_name = EXCLUDED.subject_a_taxon_name,
            subject_a_kingdom = EXCLUDED.subject_a_kingdom,
            subject_b_occurrence_uri = EXCLUDED.subject_b_occurrence_uri,
            subject_b_occurrence_cid = EXCLUDED.subject_b_occurrence_cid,
            subject_b_subject_index = EXCLUDED.subject_b_subject_index,
            subject_b_taxon_name = EXCLUDED.subject_b_taxon_name,
            subject_b_kingdom = EXCLUDED.subject_b_kingdom,
            interaction_type = EXCLUDED.interaction_type,
            direction = EXCLUDED.direction,
            confidence = EXCLUDED.confidence,
            comment = EXCLUDED.comment,
            indexed_at = NOW()
        "#,
    )
    .bind(&p.uri)
    .bind(&p.cid)
    .bind(&p.did)
    .bind(&p.subject_a_occurrence_uri)
    .bind(&p.subject_a_occurrence_cid)
    .bind(p.subject_a_subject_index)
    .bind(&p.subject_a_taxon_name)
    .bind(&p.subject_a_kingdom)
    .bind(&p.subject_b_occurrence_uri)
    .bind(&p.subject_b_occurrence_cid)
    .bind(p.subject_b_subject_index)
    .bind(&p.subject_b_taxon_name)
    .bind(&p.subject_b_kingdom)
    .bind(&p.interaction_type)
    .bind(&p.direction)
    .bind(&p.confidence)
    .bind(&p.comment)
    .bind(p.created_at)
    .execute(executor)
    .await?;
    Ok(())
}

/// Delete an interaction
pub async fn delete(executor: impl sqlx::PgExecutor<'_>, uri: &str) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM interactions WHERE uri = $1", uri)
        .execute(executor)
        .await?;
    Ok(())
}

/// Get interactions for an occurrence (as either subject A or B)
pub async fn get_for_occurrence(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
) -> Result<Vec<InteractionRow>, sqlx::Error> {
    sqlx::query_as::<_, InteractionRow>(
        r#"
        SELECT
            uri, cid, did,
            subject_a_occurrence_uri, subject_a_occurrence_cid, subject_a_subject_index,
            subject_a_taxon_name, subject_a_kingdom,
            subject_b_occurrence_uri, subject_b_occurrence_cid, subject_b_subject_index,
            subject_b_taxon_name, subject_b_kingdom,
            interaction_type, direction, confidence, comment, created_at, indexed_at
        FROM interactions
        WHERE subject_a_occurrence_uri = $1 OR subject_b_occurrence_uri = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(occurrence_uri)
    .fetch_all(executor)
    .await
}

/// Get interactions by type
pub async fn get_by_type(
    executor: impl sqlx::PgExecutor<'_>,
    interaction_type: &str,
    limit: i64,
) -> Result<Vec<InteractionRow>, sqlx::Error> {
    sqlx::query_as::<_, InteractionRow>(
        r#"
        SELECT
            uri, cid, did,
            subject_a_occurrence_uri, subject_a_occurrence_cid, subject_a_subject_index,
            subject_a_taxon_name, subject_a_kingdom,
            subject_b_occurrence_uri, subject_b_occurrence_cid, subject_b_subject_index,
            subject_b_taxon_name, subject_b_kingdom,
            interaction_type, direction, confidence, comment, created_at, indexed_at
        FROM interactions
        WHERE interaction_type = $1
        ORDER BY created_at DESC
        LIMIT $2
        "#,
    )
    .bind(interaction_type)
    .bind(limit)
    .fetch_all(executor)
    .await
}

/// Get a single interaction by URI
pub async fn get(
    executor: impl sqlx::PgExecutor<'_>,
    uri: &str,
) -> Result<Option<InteractionRow>, sqlx::Error> {
    sqlx::query_as::<_, InteractionRow>(
        r#"
        SELECT
            uri, cid, did,
            subject_a_occurrence_uri, subject_a_occurrence_cid, subject_a_subject_index,
            subject_a_taxon_name, subject_a_kingdom,
            subject_b_occurrence_uri, subject_b_occurrence_cid, subject_b_subject_index,
            subject_b_taxon_name, subject_b_kingdom,
            interaction_type, direction, confidence, comment, created_at, indexed_at
        FROM interactions
        WHERE uri = $1
        "#,
    )
    .bind(uri)
    .fetch_optional(executor)
    .await
}
