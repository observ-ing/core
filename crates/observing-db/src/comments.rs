use crate::types::{CommentRow, UpsertCommentParams};

/// Upsert a comment record
pub async fn upsert(
    executor: impl sqlx::PgExecutor<'_>,
    p: &UpsertCommentParams,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO comments (
            uri, cid, did, subject_uri, subject_cid, body,
            reply_to_uri, reply_to_cid, created_at, indexed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (uri) DO UPDATE SET
            cid = EXCLUDED.cid,
            subject_uri = EXCLUDED.subject_uri,
            subject_cid = EXCLUDED.subject_cid,
            body = EXCLUDED.body,
            reply_to_uri = EXCLUDED.reply_to_uri,
            reply_to_cid = EXCLUDED.reply_to_cid,
            created_at = EXCLUDED.created_at,
            indexed_at = NOW()
        "#,
        p.uri,
        p.cid,
        p.did,
        p.subject_uri,
        p.subject_cid,
        p.body,
        p.reply_to_uri as _,
        p.reply_to_cid as _,
        p.created_at,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Delete a comment
pub async fn delete(executor: impl sqlx::PgExecutor<'_>, uri: &str) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM comments WHERE uri = $1", uri)
        .execute(executor)
        .await?;
    Ok(())
}

/// Get all comments for an occurrence
pub async fn get_for_occurrence(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
) -> Result<Vec<CommentRow>, sqlx::Error> {
    // Note: kept as runtime query_as because CommentRow uses DateTime<Utc>
    // but the DB column is TIMESTAMP (not TIMESTAMPTZ)
    sqlx::query_as::<_, CommentRow>(
        r#"
        SELECT
            uri, cid, did, subject_uri, subject_cid, body,
            reply_to_uri, reply_to_cid, created_at
        FROM comments
        WHERE subject_uri = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(occurrence_uri)
    .fetch_all(executor)
    .await
}
