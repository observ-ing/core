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
        INSERT INTO ingester.notifications (recipient_did, actor_did, kind, subject_uri, reference_uri)
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

/// List notifications for a recipient, paginated by cursor (id), newest first.
///
/// Read-state lives in `appview.notification_reads` — the appview writes there
/// when a user marks a notification as read. We LEFT JOIN at query time so
/// callers see a single `read: bool` per row.
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
            SELECT n.id, n.recipient_did, n.actor_did, n.kind, n.subject_uri, n.reference_uri,
                   (r.notification_id IS NOT NULL) AS "read!: bool",
                   n.created_at as "created_at: DateTime<Utc>"
            FROM ingester.notifications n
            LEFT JOIN appview.notification_reads r ON r.notification_id = n.id
            WHERE n.recipient_did = $1 AND n.id < $2
            ORDER BY n.id DESC
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
            SELECT n.id, n.recipient_did, n.actor_did, n.kind, n.subject_uri, n.reference_uri,
                   (r.notification_id IS NOT NULL) AS "read!: bool",
                   n.created_at as "created_at: DateTime<Utc>"
            FROM ingester.notifications n
            LEFT JOIN appview.notification_reads r ON r.notification_id = n.id
            WHERE n.recipient_did = $1
            ORDER BY n.id DESC
            LIMIT $2
            "#,
            recipient_did,
            limit,
        )
        .fetch_all(executor)
        .await
    }
}

/// Count notifications the recipient hasn't read yet.
pub async fn unread_count(
    executor: impl sqlx::PgExecutor<'_>,
    recipient_did: &str,
) -> Result<i64, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT COUNT(*) as count
        FROM ingester.notifications n
        WHERE n.recipient_did = $1
          AND NOT EXISTS (
              SELECT 1 FROM appview.notification_reads r WHERE r.notification_id = n.id
          )
        "#,
        recipient_did,
    )
    .fetch_one(executor)
    .await?;
    Ok(row.count.unwrap_or(0))
}

/// Mark a single notification as read (only if it belongs to recipient).
pub async fn mark_read(
    executor: impl sqlx::PgExecutor<'_>,
    recipient_did: &str,
    id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO appview.notification_reads (notification_id)
        SELECT n.id FROM ingester.notifications n
        WHERE n.id = $1 AND n.recipient_did = $2
        ON CONFLICT DO NOTHING
        "#,
        id,
        recipient_did,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Mark all notifications as read for a recipient.
pub async fn mark_all_read(
    executor: impl sqlx::PgExecutor<'_>,
    recipient_did: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO appview.notification_reads (notification_id)
        SELECT n.id FROM ingester.notifications n
        WHERE n.recipient_did = $1
        ON CONFLICT DO NOTHING
        "#,
        recipient_did,
    )
    .execute(executor)
    .await?;
    Ok(())
}
