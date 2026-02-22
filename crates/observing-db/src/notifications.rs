use chrono::{DateTime, Utc};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct NotificationRow {
    pub id: i64,
    pub recipient_did: String,
    pub actor_did: String,
    pub kind: String,
    pub subject_uri: String,
    pub reference_uri: Option<String>,
    pub read: bool,
    pub created_at: DateTime<Utc>,
}

/// Insert a notification, skipping if actor == recipient
pub async fn create(
    executor: impl sqlx::PgExecutor<'_>,
    recipient_did: &str,
    actor_did: &str,
    kind: &str,
    subject_uri: &str,
    reference_uri: &str,
) -> Result<(), sqlx::Error> {
    if actor_did == recipient_did {
        return Ok(());
    }
    sqlx::query!(
        r#"
        INSERT INTO notifications (recipient_did, actor_did, kind, subject_uri, reference_uri)
        VALUES ($1, $2, $3, $4, $5)
        "#,
        recipient_did,
        actor_did,
        kind,
        subject_uri,
        reference_uri,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// List notifications for a recipient, paginated by cursor (id), newest first
pub async fn list(
    executor: impl sqlx::PgExecutor<'_>,
    recipient_did: &str,
    limit: i64,
    cursor: Option<i64>,
) -> Result<Vec<NotificationRow>, sqlx::Error> {
    if let Some(cursor_id) = cursor {
        sqlx::query_as!(
            NotificationRow,
            r#"
            SELECT id, recipient_did, actor_did, kind, subject_uri, reference_uri,
                   read, created_at as "created_at: DateTime<Utc>"
            FROM notifications
            WHERE recipient_did = $1 AND id < $2
            ORDER BY id DESC
            LIMIT $3
            "#,
            recipient_did,
            cursor_id,
            limit,
        )
        .fetch_all(executor)
        .await
    } else {
        sqlx::query_as!(
            NotificationRow,
            r#"
            SELECT id, recipient_did, actor_did, kind, subject_uri, reference_uri,
                   read, created_at as "created_at: DateTime<Utc>"
            FROM notifications
            WHERE recipient_did = $1
            ORDER BY id DESC
            LIMIT $2
            "#,
            recipient_did,
            limit,
        )
        .fetch_all(executor)
        .await
    }
}

/// Count unread notifications for a recipient
pub async fn unread_count(
    executor: impl sqlx::PgExecutor<'_>,
    recipient_did: &str,
) -> Result<i64, sqlx::Error> {
    let row = sqlx::query!(
        "SELECT COUNT(*) as count FROM notifications WHERE recipient_did = $1 AND NOT read",
        recipient_did,
    )
    .fetch_one(executor)
    .await?;
    Ok(row.count.unwrap_or(0))
}

/// Mark a single notification as read (only if it belongs to recipient)
pub async fn mark_read(
    executor: impl sqlx::PgExecutor<'_>,
    recipient_did: &str,
    id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE notifications SET read = TRUE WHERE id = $1 AND recipient_did = $2",
        id,
        recipient_did,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Mark all notifications as read for a recipient
pub async fn mark_all_read(
    executor: impl sqlx::PgExecutor<'_>,
    recipient_did: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE notifications SET read = TRUE WHERE recipient_did = $1 AND NOT read",
        recipient_did,
    )
    .execute(executor)
    .await?;
    Ok(())
}
