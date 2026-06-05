use crate::types::UserPreferencesRow;

pub async fn get(
    executor: impl sqlx::PgExecutor<'_>,
    did: &str,
) -> Result<Option<UserPreferencesRow>, sqlx::Error> {
    sqlx::query_as!(
        UserPreferencesRow,
        r#"
        SELECT did, default_license, basemap, updated_at
        FROM user_preferences
        WHERE did = $1
        "#,
        did,
    )
    .fetch_optional(executor)
    .await
}

pub async fn upsert(
    executor: impl sqlx::PgExecutor<'_>,
    did: &str,
    default_license: Option<&str>,
    basemap: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO user_preferences (did, default_license, basemap)
        VALUES ($1, $2, $3)
        ON CONFLICT (did) DO UPDATE SET
            default_license = EXCLUDED.default_license,
            basemap = EXCLUDED.basemap,
            updated_at = NOW()
        "#,
        did,
        default_license,
        basemap,
    )
    .execute(executor)
    .await?;
    Ok(())
}
