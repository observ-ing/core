use crate::types::CreateLikeParams;
use std::collections::{HashMap, HashSet};

/// Upsert a like record. Keyed by the record's uri: a user can hold more than
/// one like record for the same occurrence, and each gets its own row.
pub async fn create(
    executor: impl sqlx::PgExecutor<'_>,
    p: &CreateLikeParams,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO likes (uri, cid, did, subject_uri, subject_cid, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (uri) DO UPDATE SET
            cid = EXCLUDED.cid,
            subject_uri = EXCLUDED.subject_uri,
            subject_cid = EXCLUDED.subject_cid,
            created_at = EXCLUDED.created_at
        "#,
        p.uri,
        p.cid,
        p.did,
        p.subject_uri,
        p.subject_cid,
        p.created_at,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Delete a like by URI
pub async fn delete(executor: impl sqlx::PgExecutor<'_>, uri: &str) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM likes WHERE uri = $1", uri)
        .execute(executor)
        .await?;
    Ok(())
}

/// URIs of every like record a user holds for a subject (usually one, but a
/// double tap or a second client can create more).
pub async fn find_uris_by_subject_and_did(
    executor: impl sqlx::PgExecutor<'_>,
    subject_uri: &str,
    did: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query!(
        "SELECT uri FROM likes WHERE subject_uri = $1 AND did = $2",
        subject_uri,
        did
    )
    .fetch_all(executor)
    .await?;
    Ok(rows.into_iter().map(|r| r.uri).collect())
}

/// Get like counts (distinct likers) for multiple occurrences (batch)
pub async fn get_counts_for_occurrences(
    executor: impl sqlx::PgExecutor<'_>,
    uris: &[String],
) -> Result<HashMap<String, i32>, sqlx::Error> {
    if uris.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = sqlx::query!(
        r#"
        SELECT subject_uri, COUNT(DISTINCT did)::int as count
        FROM likes
        WHERE subject_uri = ANY($1)
        GROUP BY subject_uri
        "#,
        uris,
    )
    .fetch_all(executor)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| (r.subject_uri, r.count.unwrap_or(0)))
        .collect())
}

/// Get which occurrences a user has liked (batch)
pub async fn get_user_like_statuses(
    executor: impl sqlx::PgExecutor<'_>,
    uris: &[String],
    did: &str,
) -> Result<HashSet<String>, sqlx::Error> {
    if uris.is_empty() {
        return Ok(HashSet::new());
    }
    let rows = sqlx::query!(
        "SELECT subject_uri FROM likes WHERE subject_uri = ANY($1) AND did = $2",
        uris,
        did,
    )
    .fetch_all(executor)
    .await?;

    Ok(rows.into_iter().map(|r| r.subject_uri).collect())
}
