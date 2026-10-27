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

/// Preferences to change. `None` leaves a preference as it is; `Some(None)`
/// clears it.
#[derive(Debug, Default)]
pub struct PreferencesUpdate<'a> {
    pub default_license: Option<Option<&'a str>>,
    pub basemap: Option<Option<&'a str>>,
}

pub async fn upsert(
    executor: impl sqlx::PgExecutor<'_>,
    did: &str,
    update: &PreferencesUpdate<'_>,
) -> Result<(), sqlx::Error> {
    // Each `$n` value comes with a `$n + 1` flag saying whether to set it. A new
    // row starts with NULL in the ones left unset, the same as cleared.
    sqlx::query!(
        r#"
        INSERT INTO user_preferences (did, default_license, basemap)
        VALUES ($1, $2, $4)
        ON CONFLICT (did) DO UPDATE SET
            default_license = CASE WHEN $3 THEN EXCLUDED.default_license
                ELSE user_preferences.default_license END,
            basemap = CASE WHEN $5 THEN EXCLUDED.basemap
                ELSE user_preferences.basemap END,
            updated_at = NOW()
        "#,
        did,
        update.default_license.flatten(),
        update.default_license.is_some(),
        update.basemap.flatten(),
        update.basemap.is_some(),
    )
    .execute(executor)
    .await?;
    Ok(())
}
