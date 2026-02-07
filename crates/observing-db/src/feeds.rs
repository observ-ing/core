use crate::types::{
    ExploreFeedOptions, HomeFeedOptions, HomeFeedResult, IdentificationRow, OccurrenceRow,
    ProfileCounts, ProfileFeedOptions, ProfileFeedResult, ProfileFeedType, TaxonOccurrenceOptions,
};
use sqlx::PgPool;

/// Get the explore feed with optional filters
pub async fn get_explore_feed(
    pool: &PgPool,
    options: &ExploreFeedOptions,
) -> Result<Vec<OccurrenceRow>, sqlx::Error> {
    let mut conditions: Vec<String> = Vec::new();
    let mut param_index: usize = 1;

    // We build a dynamic query since the number of parameters varies
    // We'll collect bind values and apply them dynamically
    // Using a simpler approach with format strings for the WHERE clause
    // and binding via positional arguments

    // Since sqlx doesn't support dynamic query building easily with query_as,
    // we'll build the SQL string and use sqlx::query with manual row mapping
    let mut bind_values: Vec<BindValue> = Vec::new();

    if let Some(ref taxon) = options.taxon {
        conditions.push(format!("scientific_name ILIKE ${param_index}"));
        bind_values.push(BindValue::String(format!("{taxon}%")));
        param_index += 1;
    }

    if let Some(ref kingdom) = options.kingdom {
        conditions.push(format!("kingdom = ${param_index}"));
        bind_values.push(BindValue::String(kingdom.clone()));
        param_index += 1;
    }

    if let Some(ref start_date) = options.start_date {
        conditions.push(format!("event_date >= ${param_index}"));
        bind_values.push(BindValue::String(start_date.clone()));
        param_index += 1;
    }

    if let Some(ref end_date) = options.end_date {
        conditions.push(format!("event_date <= ${param_index}"));
        bind_values.push(BindValue::String(end_date.clone()));
        param_index += 1;
    }

    if let (Some(lat), Some(lng)) = (options.lat, options.lng) {
        let radius = options.radius.unwrap_or(10000.0);
        conditions.push(format!(
            "ST_DWithin(location, ST_SetSRID(ST_MakePoint(${}, ${}), 4326)::geography, ${})",
            param_index,
            param_index + 1,
            param_index + 2
        ));
        bind_values.push(BindValue::Float(lng));
        bind_values.push(BindValue::Float(lat));
        bind_values.push(BindValue::Float(radius));
        param_index += 3;
    }

    if let Some(ref cursor) = options.cursor {
        conditions.push(format!("created_at < ${param_index}"));
        bind_values.push(BindValue::String(cursor.clone()));
        param_index += 1;
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let limit = options.limit.unwrap_or(20);
    let limit_param = format!("${param_index}");

    let sql = format!(
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
        {where_clause}
        ORDER BY created_at DESC
        LIMIT {limit_param}
        "#,
    );

    let mut query = sqlx::query_as::<_, OccurrenceRow>(&sql);
    for val in &bind_values {
        query = match val {
            BindValue::String(s) => query.bind(s),
            BindValue::Float(f) => query.bind(f),
            BindValue::StringVec(v) => query.bind(v),
            BindValue::Int(i) => query.bind(i),
        };
    }
    query = query.bind(limit);

    query.fetch_all(pool).await
}

/// Get the profile feed for a user
pub async fn get_profile_feed(
    pool: &PgPool,
    did: &str,
    options: &ProfileFeedOptions,
) -> Result<ProfileFeedResult, sqlx::Error> {
    let limit = options.limit.unwrap_or(20);
    let feed_type = options.feed_type.as_ref().cloned().unwrap_or_default();

    // Get counts
    let counts_row: (i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            (SELECT COUNT(DISTINCT o.uri) FROM occurrences o
             LEFT JOIN occurrence_observers oo ON o.uri = oo.occurrence_uri
             WHERE o.did = $1 OR oo.observer_did = $1),
            (SELECT COUNT(*) FROM identifications WHERE did = $1),
            (SELECT COUNT(DISTINCT (o.scientific_name, o.kingdom)) FROM occurrences o
             LEFT JOIN occurrence_observers oo ON o.uri = oo.occurrence_uri
             WHERE (o.did = $1 OR oo.observer_did = $1) AND o.scientific_name IS NOT NULL)
        "#,
    )
    .bind(did)
    .fetch_one(pool)
    .await?;

    let counts = ProfileCounts {
        observations: counts_row.0,
        identifications: counts_row.1,
        species: counts_row.2,
    };

    let mut occurrences = Vec::new();
    let mut identifications = Vec::new();

    if matches!(
        feed_type,
        ProfileFeedType::Observations | ProfileFeedType::All
    ) {
        occurrences = if let Some(ref cursor) = options.cursor {
            sqlx::query_as::<_, OccurrenceRow>(
                r#"
                SELECT DISTINCT ON (o.uri)
                    o.uri, o.cid, o.did, o.scientific_name, o.event_date,
                    ST_Y(o.location::geometry) as latitude,
                    ST_X(o.location::geometry) as longitude,
                    o.coordinate_uncertainty_meters,
                    o.continent, o.country, o.country_code, o.state_province, o.county, o.municipality, o.locality, o.water_body,
                    o.verbatim_locality, o.occurrence_remarks,
                    o.associated_media, o.recorded_by,
                    o.taxon_id, o.taxon_rank, o.vernacular_name, o.kingdom, o.phylum, o.class, o."order", o.family, o.genus,
                    o.created_at,
                    NULL::float8 as distance_meters,
                    NULL::text as source,
                    COALESCE(oo.role, CASE WHEN o.did = $1 THEN 'owner' ELSE 'co-observer' END) as observer_role
                FROM occurrences o
                LEFT JOIN occurrence_observers oo ON o.uri = oo.occurrence_uri AND oo.observer_did = $1
                WHERE (o.did = $1 OR oo.observer_did = $1) AND o.created_at < $3
                ORDER BY o.uri, o.created_at DESC
                LIMIT $2
                "#,
            )
            .bind(did)
            .bind(limit)
            .bind(cursor.as_str())
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as::<_, OccurrenceRow>(
                r#"
                SELECT DISTINCT ON (o.uri)
                    o.uri, o.cid, o.did, o.scientific_name, o.event_date,
                    ST_Y(o.location::geometry) as latitude,
                    ST_X(o.location::geometry) as longitude,
                    o.coordinate_uncertainty_meters,
                    o.continent, o.country, o.country_code, o.state_province, o.county, o.municipality, o.locality, o.water_body,
                    o.verbatim_locality, o.occurrence_remarks,
                    o.associated_media, o.recorded_by,
                    o.taxon_id, o.taxon_rank, o.vernacular_name, o.kingdom, o.phylum, o.class, o."order", o.family, o.genus,
                    o.created_at,
                    NULL::float8 as distance_meters,
                    NULL::text as source,
                    COALESCE(oo.role, CASE WHEN o.did = $1 THEN 'owner' ELSE 'co-observer' END) as observer_role
                FROM occurrences o
                LEFT JOIN occurrence_observers oo ON o.uri = oo.occurrence_uri AND oo.observer_did = $1
                WHERE o.did = $1 OR oo.observer_did = $1
                ORDER BY o.uri, o.created_at DESC
                LIMIT $2
                "#,
            )
            .bind(did)
            .bind(limit)
            .fetch_all(pool)
            .await?
        };

        // Re-sort by created_at since DISTINCT ON requires ordering by uri first
        occurrences.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    }

    if matches!(
        feed_type,
        ProfileFeedType::Identifications | ProfileFeedType::All
    ) {
        identifications = if let Some(ref cursor) = options.cursor {
            sqlx::query_as::<_, IdentificationRow>(
                r#"
                SELECT
                    uri, cid, did, subject_uri, subject_cid, subject_index, scientific_name,
                    taxon_rank, identification_qualifier, taxon_id, identification_remarks,
                    identification_verification_status, type_status, is_agreement, date_identified,
                    vernacular_name, kingdom, phylum, class, "order", family, genus, confidence
                FROM identifications
                WHERE did = $1 AND date_identified < $3
                ORDER BY date_identified DESC
                LIMIT $2
                "#,
            )
            .bind(did)
            .bind(limit)
            .bind(cursor.as_str())
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as::<_, IdentificationRow>(
                r#"
                SELECT
                    uri, cid, did, subject_uri, subject_cid, subject_index, scientific_name,
                    taxon_rank, identification_qualifier, taxon_id, identification_remarks,
                    identification_verification_status, type_status, is_agreement, date_identified,
                    vernacular_name, kingdom, phylum, class, "order", family, genus, confidence
                FROM identifications
                WHERE did = $1
                ORDER BY date_identified DESC
                LIMIT $2
                "#,
            )
            .bind(did)
            .bind(limit)
            .fetch_all(pool)
            .await?
        };
    }

    Ok(ProfileFeedResult {
        occurrences,
        identifications,
        counts,
    })
}

/// Get the home feed (followed users + nearby occurrences)
pub async fn get_home_feed(
    pool: &PgPool,
    followed_dids: &[String],
    options: &HomeFeedOptions,
) -> Result<HomeFeedResult, sqlx::Error> {
    let limit = options.limit.unwrap_or(20);
    let nearby_radius = options.nearby_radius.unwrap_or(50000.0);

    let has_follows = !followed_dids.is_empty();
    let has_location = options.lat.is_some() && options.lng.is_some();

    if !has_follows && !has_location {
        return Ok(HomeFeedResult {
            rows: Vec::new(),
            followed_count: 0,
            nearby_count: 0,
        });
    }

    // Build dynamic query with CTEs
    let mut ctes: Vec<String> = Vec::new();
    let mut union_parts: Vec<String> = Vec::new();
    let mut bind_values: Vec<BindValue> = Vec::new();
    let mut param_index: usize = 1;

    if has_follows {
        bind_values.push(BindValue::StringVec(followed_dids.to_vec()));
        let follows_cursor = if let Some(ref cursor) = options.cursor {
            param_index += 1;
            bind_values.push(BindValue::String(cursor.clone()));
            format!("AND created_at < ${param_index}")
        } else {
            String::new()
        };
        param_index += 1; // for the $1 (follows array)

        ctes.push(format!(
            "follows_feed AS (
                SELECT *, 'follows'::text as source
                FROM occurrences
                WHERE did = ANY($1) {follows_cursor}
            )"
        ));
        union_parts.push("SELECT * FROM follows_feed".to_string());
    }

    if has_location {
        let lng_idx = param_index;
        let lat_idx = param_index + 1;
        let radius_idx = param_index + 2;
        param_index += 3;

        bind_values.push(BindValue::Float(options.lng.unwrap()));
        bind_values.push(BindValue::Float(options.lat.unwrap()));
        bind_values.push(BindValue::Float(nearby_radius));

        let nearby_cursor = if let Some(ref cursor) = options.cursor {
            if !has_follows {
                param_index += 1;
                bind_values.push(BindValue::String(cursor.clone()));
                format!("AND created_at < ${param_index}")
            } else {
                "AND created_at < $2".to_string()
            }
        } else {
            String::new()
        };

        ctes.push(format!(
            "nearby_feed AS (
                SELECT *, 'nearby'::text as source
                FROM occurrences
                WHERE ST_DWithin(
                    location,
                    ST_SetSRID(ST_MakePoint(${lng_idx}, ${lat_idx}), 4326)::geography,
                    ${radius_idx}
                ) {nearby_cursor}
            )"
        ));
        union_parts.push("SELECT * FROM nearby_feed".to_string());
    }

    param_index += 1;
    bind_values.push(BindValue::Int(limit));

    let sql = format!(
        r#"
        WITH {ctes},
        combined AS (
            SELECT DISTINCT ON (uri) * FROM (
                {unions}
            ) sub
            ORDER BY uri, created_at DESC
        )
        SELECT
            uri, cid, did, scientific_name, event_date,
            ST_Y(location::geometry) as latitude,
            ST_X(location::geometry) as longitude,
            coordinate_uncertainty_meters,
            continent, country, country_code, state_province, county, municipality, locality, water_body,
            verbatim_locality, occurrence_remarks,
            associated_media, recorded_by,
            taxon_id, taxon_rank, vernacular_name, kingdom, phylum, class, "order", family, genus,
            created_at, source,
            NULL::float8 as distance_meters,
            NULL::text as observer_role
        FROM combined
        ORDER BY created_at DESC
        LIMIT ${param_index}
        "#,
        ctes = ctes.join(", "),
        unions = union_parts.join(" UNION ALL "),
    );

    let mut query = sqlx::query_as::<_, OccurrenceRow>(&sql);
    for val in &bind_values {
        query = match val {
            BindValue::String(s) => query.bind(s),
            BindValue::Float(f) => query.bind(f),
            BindValue::StringVec(v) => query.bind(v),
            BindValue::Int(i) => query.bind(i),
        };
    }

    let rows = query.fetch_all(pool).await?;

    let mut followed_count = 0;
    let mut nearby_count = 0;
    for row in &rows {
        match row.source.as_deref() {
            Some("follows") => followed_count += 1,
            Some("nearby") => nearby_count += 1,
            _ => {}
        }
    }

    Ok(HomeFeedResult {
        rows,
        followed_count,
        nearby_count,
    })
}

/// Get occurrences matching a taxon by name and rank
pub async fn get_occurrences_by_taxon(
    pool: &PgPool,
    taxon_name: &str,
    taxon_rank: &str,
    options: &TaxonOccurrenceOptions,
) -> Result<Vec<OccurrenceRow>, sqlx::Error> {
    let limit = options.limit.unwrap_or(20);
    let rank_lower = taxon_rank.to_lowercase();

    let mut conditions: Vec<String> = Vec::new();
    let mut bind_values: Vec<BindValue> = Vec::new();
    let mut param_index: usize = 1;

    match rank_lower.as_str() {
        "species" | "subspecies" | "variety" => {
            conditions.push(format!("scientific_name = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
        "genus" => {
            conditions.push(format!(
                "(genus = ${} OR scientific_name ILIKE ${})",
                param_index,
                param_index + 1
            ));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            bind_values.push(BindValue::String(format!("{taxon_name} %")));
            param_index += 2;
        }
        "family" => {
            conditions.push(format!("family = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
        "order" => {
            conditions.push(format!("\"order\" = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
        "class" => {
            conditions.push(format!("class = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
        "phylum" => {
            conditions.push(format!("phylum = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
        "kingdom" => {
            conditions.push(format!("kingdom = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
        _ => {
            conditions.push(format!("scientific_name = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
    }

    if let Some(ref kingdom) = options.kingdom {
        if rank_lower != "kingdom" {
            conditions.push(format!("kingdom = ${param_index}"));
            bind_values.push(BindValue::String(kingdom.clone()));
            param_index += 1;
        }
    }

    if let Some(ref cursor) = options.cursor {
        conditions.push(format!("created_at < ${param_index}"));
        bind_values.push(BindValue::String(cursor.clone()));
        param_index += 1;
    }

    let where_clause = conditions.join(" AND ");

    let sql = format!(
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
        WHERE {where_clause}
        ORDER BY created_at DESC
        LIMIT ${param_index}
        "#,
    );

    let mut query = sqlx::query_as::<_, OccurrenceRow>(&sql);
    for val in &bind_values {
        query = match val {
            BindValue::String(s) => query.bind(s),
            BindValue::Float(f) => query.bind(f),
            BindValue::StringVec(v) => query.bind(v),
            BindValue::Int(i) => query.bind(i),
        };
    }
    query = query.bind(limit);

    query.fetch_all(pool).await
}

/// Count occurrences matching a taxon
pub async fn count_occurrences_by_taxon(
    pool: &PgPool,
    taxon_name: &str,
    taxon_rank: &str,
    kingdom: Option<&str>,
) -> Result<i64, sqlx::Error> {
    let rank_lower = taxon_rank.to_lowercase();
    let mut conditions: Vec<String> = Vec::new();
    let mut bind_values: Vec<BindValue> = Vec::new();
    let mut param_index: usize = 1;

    match rank_lower.as_str() {
        "species" | "subspecies" | "variety" => {
            conditions.push(format!("scientific_name = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
        "genus" => {
            conditions.push(format!(
                "(genus = ${} OR scientific_name ILIKE ${})",
                param_index,
                param_index + 1
            ));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            bind_values.push(BindValue::String(format!("{taxon_name} %")));
            param_index += 2;
        }
        "family" => {
            conditions.push(format!("family = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
        "order" => {
            conditions.push(format!("\"order\" = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
        "class" => {
            conditions.push(format!("class = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
        "phylum" => {
            conditions.push(format!("phylum = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
        "kingdom" => {
            conditions.push(format!("kingdom = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
        _ => {
            conditions.push(format!("scientific_name = ${param_index}"));
            bind_values.push(BindValue::String(taxon_name.to_string()));
            param_index += 1;
        }
    }

    if let Some(kingdom) = kingdom {
        if rank_lower != "kingdom" {
            conditions.push(format!("kingdom = ${param_index}"));
            bind_values.push(BindValue::String(kingdom.to_string()));
        }
    }

    let where_clause = conditions.join(" AND ");
    let sql = format!("SELECT COUNT(*) as count FROM occurrences WHERE {where_clause}");

    let mut query = sqlx::query_scalar::<_, i64>(&sql);
    for val in &bind_values {
        query = match val {
            BindValue::String(s) => query.bind(s),
            BindValue::Float(f) => query.bind(f),
            BindValue::StringVec(v) => query.bind(v),
            BindValue::Int(i) => query.bind(i),
        };
    }

    query.fetch_one(pool).await
}

/// Helper enum for dynamic query building
#[derive(Debug, Clone)]
enum BindValue {
    String(String),
    Float(f64),
    StringVec(Vec<String>),
    Int(i64),
}
