use crate::types::{CreateLikeParams, LikeCount, UserLikeStatus};
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};

/// Create a like (no-op if already exists for subject+user)
pub async fn create(pool: &PgPool, p: &CreateLikeParams) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO likes (uri, cid, did, subject_uri, subject_cid, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (subject_uri, did) DO NOTHING
        "#,
    )
    .bind(&p.uri)
    .bind(&p.cid)
    .bind(&p.did)
    .bind(&p.subject_uri)
    .bind(&p.subject_cid)
    .bind(p.created_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a like by URI
pub async fn delete(pool: &PgPool, uri: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM likes WHERE uri = $1")
        .bind(uri)
        .execute(pool)
        .await?;
    Ok(())
}

/// Delete a like by subject URI and user DID, returning the deleted like's URI
pub async fn delete_by_subject_and_did(
    pool: &PgPool,
    subject_uri: &str,
    did: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> =
        sqlx::query_as("DELETE FROM likes WHERE subject_uri = $1 AND did = $2 RETURNING uri")
            .bind(subject_uri)
            .bind(did)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.0))
}

/// Get like counts for multiple occurrences (batch)
pub async fn get_counts_for_occurrences(
    pool: &PgPool,
    uris: &[String],
) -> Result<HashMap<String, i32>, sqlx::Error> {
    if uris.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = sqlx::query_as::<_, LikeCount>(
        r#"
        SELECT subject_uri, COUNT(*)::int as count
        FROM likes
        WHERE subject_uri = ANY($1)
        GROUP BY subject_uri
        "#,
    )
    .bind(uris)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|r| (r.subject_uri, r.count)).collect())
}

/// Get which occurrences a user has liked (batch)
pub async fn get_user_like_statuses(
    pool: &PgPool,
    uris: &[String],
    did: &str,
) -> Result<HashSet<String>, sqlx::Error> {
    if uris.is_empty() {
        return Ok(HashSet::new());
    }
    let rows = sqlx::query_as::<_, UserLikeStatus>(
        "SELECT subject_uri FROM likes WHERE subject_uri = ANY($1) AND did = $2",
    )
    .bind(uris)
    .bind(did)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|r| r.subject_uri).collect())
}
