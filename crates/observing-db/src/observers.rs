use crate::types::ObserverRow;
use sqlx::PgPool;

/// Sync all observers for an occurrence (replace existing)
pub async fn sync(
    pool: &PgPool,
    occurrence_uri: &str,
    owner_did: &str,
    co_observer_dids: &[String],
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    // Delete existing observers
    sqlx::query("DELETE FROM occurrence_observers WHERE occurrence_uri = $1")
        .bind(occurrence_uri)
        .execute(&mut *tx)
        .await?;

    // Insert owner
    sqlx::query(
        r#"
        INSERT INTO occurrence_observers (occurrence_uri, observer_did, role)
        VALUES ($1, $2, 'owner')
        "#,
    )
    .bind(occurrence_uri)
    .bind(owner_did)
    .execute(&mut *tx)
    .await?;

    // Insert co-observers
    for did in co_observer_dids {
        if did != owner_did {
            sqlx::query(
                r#"
                INSERT INTO occurrence_observers (occurrence_uri, observer_did, role)
                VALUES ($1, $2, 'co-observer')
                ON CONFLICT (occurrence_uri, observer_did) DO NOTHING
                "#,
            )
            .bind(occurrence_uri)
            .bind(did)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    Ok(())
}

/// Add a single observer to an occurrence
pub async fn add(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    observer_did: &str,
    role: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO occurrence_observers (occurrence_uri, observer_did, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (occurrence_uri, observer_did) DO UPDATE SET role = $3
        "#,
    )
    .bind(occurrence_uri)
    .bind(observer_did)
    .bind(role)
    .execute(executor)
    .await?;
    Ok(())
}

/// Remove a co-observer from an occurrence (owners cannot be removed this way)
pub async fn remove(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    observer_did: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        DELETE FROM occurrence_observers
        WHERE occurrence_uri = $1 AND observer_did = $2 AND role = 'co-observer'
        "#,
    )
    .bind(occurrence_uri)
    .bind(observer_did)
    .execute(executor)
    .await?;
    Ok(())
}

/// Get all observers for an occurrence
pub async fn get_for_occurrence(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
) -> Result<Vec<ObserverRow>, sqlx::Error> {
    sqlx::query_as::<_, ObserverRow>(
        r#"
        SELECT observer_did as did, role, added_at
        FROM occurrence_observers
        WHERE occurrence_uri = $1
        ORDER BY role ASC, added_at ASC
        "#,
    )
    .bind(occurrence_uri)
    .fetch_all(executor)
    .await
}

/// Check if a user is the owner of an occurrence
pub async fn is_owner(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
    did: &str,
) -> Result<bool, sqlx::Error> {
    let row: Option<(i32,)> = sqlx::query_as(
        r#"
        SELECT 1 as exists_ FROM occurrence_observers
        WHERE occurrence_uri = $1 AND observer_did = $2 AND role = 'owner'
        "#,
    )
    .bind(occurrence_uri)
    .bind(did)
    .fetch_optional(executor)
    .await?;
    Ok(row.is_some())
}
