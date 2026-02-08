use crate::types::{OccurrenceRow, UpsertOccurrenceParams};

/// Upsert an occurrence record
pub async fn upsert(
    executor: impl sqlx::PgExecutor<'_>,
    p: &UpsertOccurrenceParams,
) -> Result<(), sqlx::Error> {
    sqlx::query(
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
    )
    .bind(&p.uri)
    .bind(&p.cid)
    .bind(&p.did)
    .bind(&p.scientific_name)
    .bind(p.event_date)
    .bind(p.longitude)
    .bind(p.latitude)
    .bind(p.coordinate_uncertainty_meters)
    .bind(&p.continent)
    .bind(&p.country)
    .bind(&p.country_code)
    .bind(&p.state_province)
    .bind(&p.county)
    .bind(&p.municipality)
    .bind(&p.locality)
    .bind(&p.water_body)
    .bind(&p.verbatim_locality)
    .bind(&p.occurrence_remarks)
    .bind(&p.associated_media)
    .bind(&p.recorded_by)
    .bind(&p.taxon_id)
    .bind(&p.taxon_rank)
    .bind(&p.vernacular_name)
    .bind(&p.kingdom)
    .bind(&p.phylum)
    .bind(&p.class)
    .bind(&p.order)
    .bind(&p.family)
    .bind(&p.genus)
    .bind(p.created_at)
    .execute(executor)
    .await?;
    Ok(())
}

/// Delete an occurrence
pub async fn delete(executor: impl sqlx::PgExecutor<'_>, uri: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM occurrences WHERE uri = $1")
        .bind(uri)
        .execute(executor)
        .await?;
    Ok(())
}

/// Get a single occurrence by URI
pub async fn get(
    executor: impl sqlx::PgExecutor<'_>,
    uri: &str,
) -> Result<Option<OccurrenceRow>, sqlx::Error> {
    sqlx::query_as::<_, OccurrenceRow>(
        r#"
        SELECT
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
        FROM occurrences
        WHERE uri = $1
        "#,
    )
    .bind(uri)
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
    sqlx::query_as::<_, OccurrenceRow>(
        r#"
        SELECT
            uri, cid, did, scientific_name, event_date,
            ST_Y(location::geometry) as latitude,
            ST_X(location::geometry) as longitude,
            coordinate_uncertainty_meters,
            continent, country, country_code, state_province, county, municipality, locality, water_body,
            verbatim_locality, occurrence_remarks,
            associated_media, recorded_by,
            taxon_id, taxon_rank, vernacular_name, kingdom, phylum, class, "order", family, genus,
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
    )
    .bind(lat)
    .bind(lng)
    .bind(radius_meters)
    .bind(limit)
    .bind(offset)
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
    sqlx::query_as::<_, OccurrenceRow>(
        r#"
        SELECT
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
        FROM occurrences
        WHERE location && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
        LIMIT $5
        "#,
    )
    .bind(min_lng)
    .bind(min_lat)
    .bind(max_lng)
    .bind(max_lat)
    .bind(limit)
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
        sqlx::query_as::<_, OccurrenceRow>(
            r#"
            SELECT
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
            FROM occurrences
            WHERE created_at < $2
            ORDER BY created_at DESC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .bind(cursor)
        .fetch_all(executor)
        .await
    } else {
        sqlx::query_as::<_, OccurrenceRow>(
            r#"
            SELECT
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
            FROM occurrences
            ORDER BY created_at DESC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(executor)
        .await
    }
}
