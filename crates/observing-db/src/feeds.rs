use crate::occurrence_columns;
use crate::types::{
    ExploreFeedOptions, HomeFeedOptions, IdentificationRow, OccurrenceRow, ProfileCounts,
    ProfileFeedOptions, ProfileFeedResult, ProfileFeedType, TaxonOccurrenceOptions,
};
use sqlx::{PgPool, Postgres, QueryBuilder};

/// Get the explore feed with optional filters
pub async fn get_explore_feed(
    executor: impl sqlx::PgExecutor<'_>,
    options: &ExploreFeedOptions,
    hidden_dids: &[String],
) -> Result<Vec<OccurrenceRow>, sqlx::Error> {
    let mut qb = QueryBuilder::<Postgres>::new(concat!(
        "SELECT ",
        occurrence_columns!(),
        " FROM occurrences WHERE TRUE"
    ));

    if !hidden_dids.is_empty() {
        qb.push(" AND did != ALL(");
        qb.push_bind(hidden_dids.to_vec());
        qb.push(")");
    }

    if let Some(ref taxon) = options.taxon {
        qb.push(" AND scientific_name ILIKE ");
        qb.push_bind(format!("{taxon}%"));
    }

    if let Some(kingdom) = options.kingdom.as_deref() {
        qb.push(" AND kingdom = ");
        qb.push_bind(kingdom);
    }

    if let Some(start_date) = options.start_date.as_deref() {
        qb.push(" AND event_date >= ");
        qb.push_bind(start_date);
    }

    if let Some(end_date) = options.end_date.as_deref() {
        qb.push(" AND event_date <= ");
        qb.push_bind(end_date);
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

    if let Some(cursor) = options.cursor.as_deref() {
        qb.push(" AND created_at < ");
        qb.push_bind(cursor);
        qb.push("::timestamptz");
    }

    let limit = options.limit.unwrap_or(20);
    qb.push(" ORDER BY created_at DESC LIMIT ");
    qb.push_bind(limit);

    qb.build_query_as::<OccurrenceRow>()
        .fetch_all(executor)
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
            sqlx::query_as!(
                OccurrenceRow,
                r#"
                SELECT DISTINCT ON (o.uri)
                    o.uri, o.cid, o.did, o.scientific_name, o.event_date,
                    ST_Y(o.location::geometry) as "latitude!",
                    ST_X(o.location::geometry) as "longitude!",
                    o.coordinate_uncertainty_meters,
                    o.associated_media, o.recorded_by,
                    o.taxon_id, o.taxon_rank, o.vernacular_name, o.kingdom, o.phylum, o.class, o."order" as order_, o.family, o.genus,
                    o.created_at,
                    NULL::float8 as distance_meters,
                    NULL::text as source,
                    COALESCE(oo.role, CASE WHEN o.did = $1 THEN 'owner' ELSE 'co-observer' END) as observer_role
                FROM occurrences o
                LEFT JOIN occurrence_observers oo ON o.uri = oo.occurrence_uri AND oo.observer_did = $1
                WHERE (o.did = $1 OR oo.observer_did = $1) AND o.created_at < ($3::text)::timestamptz
                ORDER BY o.uri, o.created_at DESC
                LIMIT $2
                "#,
                did,
                limit,
                cursor.as_str(),
            )
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as!(
                OccurrenceRow,
                r#"
                SELECT DISTINCT ON (o.uri)
                    o.uri, o.cid, o.did, o.scientific_name, o.event_date,
                    ST_Y(o.location::geometry) as "latitude!",
                    ST_X(o.location::geometry) as "longitude!",
                    o.coordinate_uncertainty_meters,
                    o.associated_media, o.recorded_by,
                    o.taxon_id, o.taxon_rank, o.vernacular_name, o.kingdom, o.phylum, o.class, o."order" as order_, o.family, o.genus,
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
                did,
                limit,
            )
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
            sqlx::query_as!(
                IdentificationRow,
                r#"
                SELECT
                    uri, cid, did, subject_uri, subject_cid, scientific_name,
                    taxon_rank, identification_qualifier, taxon_id,
                    identification_verification_status, type_status, is_agreement, date_identified,
                    vernacular_name, kingdom, phylum, class, "order" as order_, family, genus
                FROM identifications
                WHERE did = $1 AND date_identified < ($3::text)::timestamptz
                ORDER BY date_identified DESC
                LIMIT $2
                "#,
                did,
                limit,
                cursor.as_str(),
            )
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as!(
                IdentificationRow,
                r#"
                SELECT
                    uri, cid, did, subject_uri, subject_cid, scientific_name,
                    taxon_rank, identification_qualifier, taxon_id,
                    identification_verification_status, type_status, is_agreement, date_identified,
                    vernacular_name, kingdom, phylum, class, "order" as order_, family, genus
                FROM identifications
                WHERE did = $1
                ORDER BY date_identified DESC
                LIMIT $2
                "#,
                did,
                limit,
            )
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

/// Get the home feed (all occurrences, reverse chronological)
pub async fn get_home_feed(
    executor: impl sqlx::PgExecutor<'_>,
    options: &HomeFeedOptions,
    hidden_dids: &[String],
) -> Result<Vec<OccurrenceRow>, sqlx::Error> {
    let mut qb = QueryBuilder::<Postgres>::new(concat!(
        "SELECT ",
        occurrence_columns!(),
        " FROM occurrences WHERE TRUE"
    ));

    if !hidden_dids.is_empty() {
        qb.push(" AND did != ALL(");
        qb.push_bind(hidden_dids.to_vec());
        qb.push(")");
    }

    if let Some(cursor) = options.cursor.as_deref() {
        qb.push(" AND created_at < ");
        qb.push_bind(cursor);
        qb.push("::timestamptz");
    }

    let limit = options.limit.unwrap_or(20);
    qb.push(" ORDER BY created_at DESC LIMIT ");
    qb.push_bind(limit);

    qb.build_query_as::<OccurrenceRow>()
        .fetch_all(executor)
        .await
}

/// Get occurrences matching a taxon by name and rank
pub async fn get_occurrences_by_taxon(
    executor: impl sqlx::PgExecutor<'_>,
    taxon_name: &str,
    taxon_rank: &str,
    options: &TaxonOccurrenceOptions,
    hidden_dids: &[String],
) -> Result<Vec<OccurrenceRow>, sqlx::Error> {
    let limit = options.limit.unwrap_or(20);
    let rank_lower = taxon_rank.to_lowercase();

    let mut qb = QueryBuilder::<Postgres>::new(concat!(
        "SELECT ",
        occurrence_columns!(),
        " FROM occurrences WHERE "
    ));

    push_taxon_filter(&mut qb, &rank_lower, taxon_name);

    if !hidden_dids.is_empty() {
        qb.push(" AND did != ALL(");
        qb.push_bind(hidden_dids.to_vec());
        qb.push(")");
    }

    if let Some(kingdom) = options.kingdom.as_deref() {
        if rank_lower != "kingdom" {
            qb.push(" AND kingdom = ");
            qb.push_bind(kingdom);
        }
    }

    if let Some(cursor) = options.cursor.as_deref() {
        qb.push(" AND created_at < ");
        qb.push_bind(cursor);
        qb.push("::timestamptz");
    }

    qb.push(" ORDER BY created_at DESC LIMIT ");
    qb.push_bind(limit);

    qb.build_query_as::<OccurrenceRow>()
        .fetch_all(executor)
        .await
}

/// Count occurrences matching a taxon
pub async fn count_occurrences_by_taxon(
    executor: impl sqlx::PgExecutor<'_>,
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

    let (count,): (i64,) = qb.build_query_as().fetch_one(executor).await?;
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
