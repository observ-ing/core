use crate::types::{CommentRow, UpsertCommentParams};
use sqlx::PgPool;

/// Upsert a comment record
pub async fn upsert(pool: &PgPool, p: &UpsertCommentParams) -> Result<(), sqlx::Error> {
    sqlx::query(
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
    )
    .bind(&p.uri)
    .bind(&p.cid)
    .bind(&p.did)
    .bind(&p.subject_uri)
    .bind(&p.subject_cid)
    .bind(&p.body)
    .bind(&p.reply_to_uri)
    .bind(&p.reply_to_cid)
    .bind(p.created_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a comment
pub async fn delete(pool: &PgPool, uri: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM comments WHERE uri = $1")
        .bind(uri)
        .execute(pool)
        .await?;
    Ok(())
}

/// Get all comments for an occurrence
pub async fn get_for_occurrence(
    pool: &PgPool,
    occurrence_uri: &str,
) -> Result<Vec<CommentRow>, sqlx::Error> {
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
    .fetch_all(pool)
    .await
}
