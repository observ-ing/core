use crate::types::{OccurrenceRow, UpsertOccurrenceParams};

/// Standard SELECT columns for OccurrenceRow in QueryBuilder (runtime) queries.
/// Does not include the SELECT keyword or FROM clause.
/// Use with `concat!` for compile-time string composition:
/// ```ignore
/// concat!("SELECT ", occurrence_columns!(), " FROM occurrences WHERE TRUE")
/// ```
#[macro_export]
macro_rules! occurrence_columns {
    () => {
        r#"
    uri, cid, did, scientific_name, event_date,
    ST_Y(location::geometry) as latitude,
    ST_X(location::geometry) as longitude,
    coordinate_uncertainty_meters,
    continent, country, country_code, state_province, county, municipality, locality, water_body,
    verbatim_locality, occurrence_remarks,
    associated_media, recorded_by,
    taxon_id, taxon_rank, vernacular_name, kingdom, phylum, class, "order", family, genus,
    created_at,
    NULL::float8 as distance_meters,
    NULL::text as source,
    NULL::text as observer_role
"#
    };
}

/// Upsert an occurrence record
pub async fn upsert(
    executor: impl sqlx::PgExecutor<'_>,
    p: &UpsertOccurrenceParams,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO occurrences (
            uri, cid, did, scientific_name, event_date, location,
            coordinate_uncertainty_meters,
            continent, country, country_code, state_province, county, municipality, locality, water_body,
            verbatim_locality, occurrence_remarks, associated_media, recorded_by,
            taxon_id, taxon_rank, vernacular_name, kingdom, phylum, class, "order", family, genus,
            created_at
        ) VALUES (
            $1, $2, $3, $4, $5,
            ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
            $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
        )
        ON CONFLICT (uri) DO UPDATE SET
            cid = $2,
            scientific_name = $4,
            event_date = $5,
            location = ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
            coordinate_uncertainty_meters = $8,
            continent = COALESCE($9, occurrences.continent),
            country = COALESCE($10, occurrences.country),
            country_code = COALESCE($11, occurrences.country_code),
            state_province = COALESCE($12, occurrences.state_province),
            county = COALESCE($13, occurrences.county),
            municipality = COALESCE($14, occurrences.municipality),
            locality = COALESCE($15, occurrences.locality),
            water_body = COALESCE($16, occurrences.water_body),
            verbatim_locality = $17,
            occurrence_remarks = $18,
            associated_media = COALESCE($19, occurrences.associated_media),
            recorded_by = COALESCE($20, occurrences.recorded_by),
            taxon_id = COALESCE($21, occurrences.taxon_id),
            taxon_rank = COALESCE($22, occurrences.taxon_rank),
            vernacular_name = COALESCE($23, occurrences.vernacular_name),
            kingdom = COALESCE($24, occurrences.kingdom),
            phylum = COALESCE($25, occurrences.phylum),
            class = COALESCE($26, occurrences.class),
            "order" = COALESCE($27, occurrences."order"),
            family = COALESCE($28, occurrences.family),
            genus = COALESCE($29, occurrences.genus),
            indexed_at = NOW()
        "#,
        p.uri,
        p.cid,
        p.did,
        p.scientific_name as _,
        p.event_date,
        p.longitude,
        p.latitude,
        p.coordinate_uncertainty_meters as _,
        p.continent as _,
        p.country as _,
        p.country_code as _,
        p.state_province as _,
        p.county as _,
        p.municipality as _,
        p.locality as _,
        p.water_body as _,
        p.verbatim_locality as _,
        p.occurrence_remarks as _,
        p.associated_media as _,
        p.recorded_by as _,
        p.taxon_id as _,
        p.taxon_rank as _,
        p.vernacular_name as _,
        p.kingdom as _,
        p.phylum as _,
        p.class as _,
        p.order as _,
        p.family as _,
        p.genus as _,
        p.created_at,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Delete an occurrence
pub async fn delete(executor: impl sqlx::PgExecutor<'_>, uri: &str) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM occurrences WHERE uri = $1", uri)
        .execute(executor)
        .await?;
    Ok(())
}

/// Get a single occurrence by URI
pub async fn get(
    executor: impl sqlx::PgExecutor<'_>,
    uri: &str,
) -> Result<Option<OccurrenceRow>, sqlx::Error> {
    sqlx::query_as!(
        OccurrenceRow,
        r#"
        SELECT
            uri, cid, did, scientific_name, event_date,
            ST_Y(location::geometry) as "latitude!",
            ST_X(location::geometry) as "longitude!",
            coordinate_uncertainty_meters,
            continent, country, country_code, state_province, county, municipality, locality, water_body,
            verbatim_locality, occurrence_remarks,
            associated_media, recorded_by,
            taxon_id, taxon_rank, vernacular_name, kingdom, phylum, class, "order" as order_, family, genus,
            created_at,
            NULL::float8 as distance_meters,
            NULL::text as source,
            NULL::text as observer_role
        FROM occurrences
        WHERE uri = $1
        "#,
        uri,
    )
    .fetch_optional(executor)
    .await
}

/// Get occurrences nearby a point
pub async fn get_nearby(
    executor: impl sqlx::PgExecutor<'_>,
    lat: f64,
    lng: f64,
    radius_meters: f64,
    limit: i64,
    offset: i64,
    hidden_dids: &[String],
) -> Result<Vec<OccurrenceRow>, sqlx::Error> {
    sqlx::query_as!(
        OccurrenceRow,
        r#"
        SELECT
            uri, cid, did, scientific_name, event_date,
            ST_Y(location::geometry) as "latitude!",
            ST_X(location::geometry) as "longitude!",
            coordinate_uncertainty_meters,
            continent, country, country_code, state_province, county, municipality, locality, water_body,
            verbatim_locality, occurrence_remarks,
            associated_media, recorded_by,
            taxon_id, taxon_rank, vernacular_name, kingdom, phylum, class, "order" as order_, family, genus,
            created_at,
            ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_meters,
            NULL::text as source,
            NULL::text as observer_role
        FROM occurrences
        WHERE ST_DWithin(
            location,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
            $3
        )
        AND did != ALL($6)
        ORDER BY distance_meters
        LIMIT $4 OFFSET $5
        "#,
        lat,
        lng,
        radius_meters,
        limit,
        offset,
        hidden_dids,
    )
    .fetch_all(executor)
    .await
}

/// Get occurrences within a bounding box
pub async fn get_by_bounding_box(
    executor: impl sqlx::PgExecutor<'_>,
    min_lat: f64,
    min_lng: f64,
    max_lat: f64,
    max_lng: f64,
    limit: i64,
    hidden_dids: &[String],
) -> Result<Vec<OccurrenceRow>, sqlx::Error> {
    sqlx::query_as!(
        OccurrenceRow,
        r#"
        SELECT
            uri, cid, did, scientific_name, event_date,
            ST_Y(location::geometry) as "latitude!",
            ST_X(location::geometry) as "longitude!",
            coordinate_uncertainty_meters,
            continent, country, country_code, state_province, county, municipality, locality, water_body,
            verbatim_locality, occurrence_remarks,
            associated_media, recorded_by,
            taxon_id, taxon_rank, vernacular_name, kingdom, phylum, class, "order" as order_, family, genus,
            created_at,
            NULL::float8 as distance_meters,
            NULL::text as source,
            NULL::text as observer_role
        FROM occurrences
        WHERE location && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
        AND did != ALL($6)
        LIMIT $5
        "#,
        min_lng,
        min_lat,
        max_lng,
        max_lat,
        limit,
        hidden_dids,
    )
    .fetch_all(executor)
    .await
}

/// Get occurrences feed (chronological, cursor-based)
pub async fn get_feed(
    executor: impl sqlx::PgExecutor<'_>,
    limit: i64,
    cursor: Option<&str>,
    hidden_dids: &[String],
) -> Result<Vec<OccurrenceRow>, sqlx::Error> {
    if let Some(cursor) = cursor {
        sqlx::query_as!(
            OccurrenceRow,
            r#"
            SELECT
                uri, cid, did, scientific_name, event_date,
                ST_Y(location::geometry) as "latitude!",
                ST_X(location::geometry) as "longitude!",
                coordinate_uncertainty_meters,
                continent, country, country_code, state_province, county, municipality, locality, water_body,
                verbatim_locality, occurrence_remarks,
                associated_media, recorded_by,
                taxon_id, taxon_rank, vernacular_name, kingdom, phylum, class, "order" as order_, family, genus,
                created_at,
                NULL::float8 as distance_meters,
                NULL::text as source,
                NULL::text as observer_role
            FROM occurrences
            WHERE created_at < ($2::text)::timestamptz
            AND did != ALL($3)
            ORDER BY created_at DESC
            LIMIT $1
            "#,
            limit,
            cursor,
            hidden_dids,
        )
        .fetch_all(executor)
        .await
    } else {
        sqlx::query_as!(
            OccurrenceRow,
            r#"
            SELECT
                uri, cid, did, scientific_name, event_date,
                ST_Y(location::geometry) as "latitude!",
                ST_X(location::geometry) as "longitude!",
                coordinate_uncertainty_meters,
                continent, country, country_code, state_province, county, municipality, locality, water_body,
                verbatim_locality, occurrence_remarks,
                associated_media, recorded_by,
                taxon_id, taxon_rank, vernacular_name, kingdom, phylum, class, "order" as order_, family, genus,
                created_at,
                NULL::float8 as distance_meters,
                NULL::text as source,
                NULL::text as observer_role
            FROM occurrences
            WHERE did != ALL($2)
            ORDER BY created_at DESC
            LIMIT $1
            "#,
            limit,
            hidden_dids,
        )
        .fetch_all(executor)
        .await
    }
}
