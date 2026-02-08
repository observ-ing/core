use crate::types::{OccurrenceRow, UpsertOccurrenceParams};

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
            continent = $9,
            country = $10,
            country_code = $11,
            state_province = $12,
            county = $13,
            municipality = $14,
            locality = $15,
            water_body = $16,
            verbatim_locality = $17,
            occurrence_remarks = $18,
            associated_media = $19,
            recorded_by = $20,
            taxon_id = $21,
            taxon_rank = $22,
            vernacular_name = $23,
            kingdom = $24,
            phylum = $25,
            class = $26,
            "order" = $27,
            family = $28,
            genus = $29,
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
        ORDER BY distance_meters
        LIMIT $4 OFFSET $5
        "#,
        lat,
        lng,
        radius_meters,
        limit,
        offset,
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
        LIMIT $5
        "#,
        min_lng,
        min_lat,
        max_lng,
        max_lat,
        limit,
    )
    .fetch_all(executor)
    .await
}

/// Get occurrences feed (chronological, cursor-based)
pub async fn get_feed(
    executor: impl sqlx::PgExecutor<'_>,
    limit: i64,
    cursor: Option<&str>,
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
            ORDER BY created_at DESC
            LIMIT $1
            "#,
            limit,
            cursor,
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
            ORDER BY created_at DESC
            LIMIT $1
            "#,
            limit,
        )
        .fetch_all(executor)
        .await
    }
}
