use crate::types::OccurrencePrivateDataRow;

/// Save private location data for an occurrence
pub async fn save(
    executor: impl sqlx::PgExecutor<'_>,
    uri: &str,
    lat: f64,
    lng: f64,
    geoprivacy: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO occurrence_private_data (uri, exact_location, geoprivacy, effective_geoprivacy)
        VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $4)
        ON CONFLICT (uri) DO UPDATE SET
            exact_location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
            geoprivacy = $4,
            effective_geoprivacy = $4,
            updated_at = NOW()
        "#,
    )
    .bind(uri)
    .bind(lng)
    .bind(lat)
    .bind(geoprivacy)
    .execute(executor)
    .await?;
    Ok(())
}

/// Get private location data for an occurrence
pub async fn get(
    executor: impl sqlx::PgExecutor<'_>,
    uri: &str,
) -> Result<Option<OccurrencePrivateDataRow>, sqlx::Error> {
    sqlx::query_as::<_, OccurrencePrivateDataRow>(
        r#"
        SELECT
            ST_Y(exact_location::geometry) as exact_latitude,
            ST_X(exact_location::geometry) as exact_longitude,
            geoprivacy,
            effective_geoprivacy
        FROM occurrence_private_data
        WHERE uri = $1
        "#,
    )
    .bind(uri)
    .fetch_optional(executor)
    .await
}

/// Delete private location data for an occurrence
pub async fn delete(executor: impl sqlx::PgExecutor<'_>, uri: &str) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM occurrence_private_data WHERE uri = $1", uri)
        .execute(executor)
        .await?;
    Ok(())
}
