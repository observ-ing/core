use crate::types::ObserverRow;
use sqlx::PgPool;
use std::collections::HashMap;

/// Sync all observers for an occurrence (replace existing)
pub async fn sync(
    pool: &PgPool,
    occurrence_uri: &str,
    owner_did: &str,
    co_observer_dids: &[String],
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    // Delete existing observers
    sqlx::query!(
        "DELETE FROM occurrence_observers WHERE occurrence_uri = $1",
        occurrence_uri
    )
    .execute(&mut *tx)
    .await?;

    // Insert owner
    sqlx::query!(
        r#"
        INSERT INTO occurrence_observers (occurrence_uri, observer_did, role)
        VALUES ($1, $2, 'owner')
        "#,
        occurrence_uri,
        owner_did,
    )
    .execute(&mut *tx)
    .await?;

    // Insert co-observers
    for did in co_observer_dids {
        if did != owner_did {
            sqlx::query!(
                r#"
                INSERT INTO occurrence_observers (occurrence_uri, observer_did, role)
                VALUES ($1, $2, 'co-observer')
                ON CONFLICT (occurrence_uri, observer_did) DO NOTHING
                "#,
                occurrence_uri,
                did.as_str(),
            )
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    Ok(())
}

/// Get all observers for an occurrence
pub async fn get_for_occurrence(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uri: &str,
) -> Result<Vec<ObserverRow>, sqlx::Error> {
    sqlx::query_as!(
        ObserverRow,
        r#"
        SELECT observer_did as did, role, added_at
        FROM occurrence_observers
        WHERE occurrence_uri = $1
        ORDER BY role ASC, added_at ASC
        "#,
        occurrence_uri,
    )
    .fetch_all(executor)
    .await
}

/// Get all observers for multiple occurrences (batch)
pub async fn get_for_occurrences(
    executor: impl sqlx::PgExecutor<'_>,
    uris: &[String],
) -> Result<HashMap<String, Vec<ObserverRow>>, sqlx::Error> {
    if uris.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT occurrence_uri, observer_did as did, role, added_at
        FROM occurrence_observers
        WHERE occurrence_uri = ANY($1)
        ORDER BY occurrence_uri, role ASC, added_at ASC
        "#,
        uris,
    )
    .fetch_all(executor)
    .await?;

    let mut map: HashMap<String, Vec<ObserverRow>> = HashMap::new();
    for row in rows {
        map.entry(row.occurrence_uri)
            .or_default()
            .push(ObserverRow {
                did: row.did,
                role: row.role,
                added_at: row.added_at,
            });
    }
    Ok(map)
}
