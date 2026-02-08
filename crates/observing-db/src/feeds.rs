use crate::types::{
    ExploreFeedOptions, HomeFeedOptions, HomeFeedResult, IdentificationRow, OccurrenceRow,
    ProfileCounts, ProfileFeedOptions, ProfileFeedResult, ProfileFeedType, TaxonOccurrenceOptions,
};
use sqlx::{PgPool, Postgres, QueryBuilder};

/// Get the explore feed with optional filters
pub async fn get_explore_feed(
    pool: &PgPool,
    options: &ExploreFeedOptions,
) -> Result<Vec<OccurrenceRow>, sqlx::Error> {
    let mut qb = QueryBuilder::<Postgres>::new(
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
        WHERE TRUE
        "#,
    );

    if let Some(ref taxon) = options.taxon {
        qb.push(" AND scientific_name ILIKE ");
        qb.push_bind(format!("{taxon}%"));
    }

    if let Some(ref kingdom) = options.kingdom {
        qb.push(" AND kingdom = ");
        qb.push_bind(kingdom.clone());
    }

    if let Some(ref start_date) = options.start_date {
        qb.push(" AND event_date >= ");
        qb.push_bind(start_date.clone());
    }

    if let Some(ref end_date) = options.end_date {
        qb.push(" AND event_date <= ");
        qb.push_bind(end_date.clone());
    }

    if let (Some(lat), Some(lng)) = (options.lat, options.lng) {
        let radius = options.radius.unwrap_or(10000.0);
        qb.push(" AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(");
        qb.push_bind(lng);
        qb.push(", ");
        qb.push_bind(lat);
        qb.push("), 4326)::geography, ");
        qb.push_bind(radius);
        qb.push(")");
    }

    if let Some(ref cursor) = options.cursor {
        qb.push(" AND created_at < ");
        qb.push_bind(cursor.clone());
    }

    let limit = options.limit.unwrap_or(20);
    qb.push(" ORDER BY created_at DESC LIMIT ");
    qb.push_bind(limit);

    qb.build_query_as::<OccurrenceRow>()
        .fetch_all(pool)
        .await
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

    let mut qb = QueryBuilder::<Postgres>::new("WITH ");

    if has_follows {
        qb.push("follows_feed AS (SELECT *, 'follows'::text as source FROM occurrences WHERE did = ANY(");
        qb.push_bind(followed_dids.to_vec());
        qb.push(")");
        if let Some(ref cursor) = options.cursor {
            qb.push(" AND created_at < ");
            qb.push_bind(cursor.clone());
        }
        qb.push(")");
    }

    if has_location {
        if has_follows {
            qb.push(", ");
        }
        qb.push("nearby_feed AS (SELECT *, 'nearby'::text as source FROM occurrences WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(");
        qb.push_bind(options.lng.unwrap());
        qb.push(", ");
        qb.push_bind(options.lat.unwrap());
        qb.push("), 4326)::geography, ");
        qb.push_bind(nearby_radius);
        qb.push(")");
        if let Some(ref cursor) = options.cursor {
            qb.push(" AND created_at < ");
            qb.push_bind(cursor.clone());
        }
        qb.push(")");
    }

    qb.push(", combined AS (SELECT DISTINCT ON (uri) * FROM (");
    if has_follows {
        qb.push("SELECT * FROM follows_feed");
    }
    if has_follows && has_location {
        qb.push(" UNION ALL ");
    }
    if has_location {
        qb.push("SELECT * FROM nearby_feed");
    }
    qb.push(") sub ORDER BY uri, created_at DESC) ");

    qb.push(
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
            created_at, source,
            NULL::float8 as distance_meters,
            NULL::text as observer_role
        FROM combined
        ORDER BY created_at DESC
        LIMIT "#,
    );
    qb.push_bind(limit);

    let rows = qb
        .build_query_as::<OccurrenceRow>()
        .fetch_all(pool)
        .await?;

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

    let mut qb = QueryBuilder::<Postgres>::new(
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
        WHERE "#,
    );

    push_taxon_filter(&mut qb, &rank_lower, taxon_name);

    if let Some(ref kingdom) = options.kingdom {
        if rank_lower != "kingdom" {
            qb.push(" AND kingdom = ");
            qb.push_bind(kingdom.clone());
        }
    }

    if let Some(ref cursor) = options.cursor {
        qb.push(" AND created_at < ");
        qb.push_bind(cursor.clone());
    }

    qb.push(" ORDER BY created_at DESC LIMIT ");
    qb.push_bind(limit);

    qb.build_query_as::<OccurrenceRow>()
        .fetch_all(pool)
        .await
}

/// Count occurrences matching a taxon
pub async fn count_occurrences_by_taxon(
    pool: &PgPool,
    taxon_name: &str,
    taxon_rank: &str,
    kingdom: Option<&str>,
) -> Result<i64, sqlx::Error> {
    let rank_lower = taxon_rank.to_lowercase();

    let mut qb = QueryBuilder::<Postgres>::new("SELECT COUNT(*) FROM occurrences WHERE ");

    push_taxon_filter(&mut qb, &rank_lower, taxon_name);

    if let Some(kingdom) = kingdom {
        if rank_lower != "kingdom" {
            qb.push(" AND kingdom = ");
            qb.push_bind(kingdom.to_string());
        }
    }

    let (count,): (i64,) = qb.build_query_as().fetch_one(pool).await?;
    Ok(count)
}

/// Push the appropriate taxon filter condition onto a query builder
fn push_taxon_filter(qb: &mut QueryBuilder<'_, Postgres>, rank_lower: &str, taxon_name: &str) {
    match rank_lower {
        "species" | "subspecies" | "variety" => {
            qb.push("scientific_name = ");
            qb.push_bind(taxon_name.to_string());
        }
        "genus" => {
            qb.push("(genus = ");
            qb.push_bind(taxon_name.to_string());
            qb.push(" OR scientific_name ILIKE ");
            qb.push_bind(format!("{taxon_name} %"));
            qb.push(")");
        }
        "family" => {
            qb.push("family = ");
            qb.push_bind(taxon_name.to_string());
        }
        "order" => {
            qb.push(r#""order" = "#);
            qb.push_bind(taxon_name.to_string());
        }
        "class" => {
            qb.push("class = ");
            qb.push_bind(taxon_name.to_string());
        }
        "phylum" => {
            qb.push("phylum = ");
            qb.push_bind(taxon_name.to_string());
        }
        "kingdom" => {
            qb.push("kingdom = ");
            qb.push_bind(taxon_name.to_string());
        }
        _ => {
            qb.push("scientific_name = ");
            qb.push_bind(taxon_name.to_string());
        }
    }
}
