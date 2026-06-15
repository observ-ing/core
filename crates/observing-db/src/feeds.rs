use crate::occurrence_columns;
use crate::quality::{QualityCriterion, IMPRECISE_UNCERTAINTY_THRESHOLD_M};
use crate::types::{
    ExploreFeedOptions, HomeFeedOptions, IdentificationRow, OccurrenceRow, ProfileCounts,
    ProfileFeedOptions, ProfileFeedResult, ProfileFeedType, TaxonOccurrenceOptions,
};
use sqlx::{PgPool, Postgres, QueryBuilder};

/// Append the keyset-pagination predicate for a feed cursor.
///
/// Feeds order by `(created_at DESC, uri DESC)`. `created_at` is not unique, so
/// a timestamp-only cursor (`created_at < $ts`) skips every other row sharing
/// the boundary timestamp and ties sort arbitrarily between queries. The cursor
/// encodes both halves as `"<created_at>|<uri>"` (see
/// `OccurrenceResponse::feed_cursor` in the appview) and we compare the row
/// tuple against it. Any caller that uses this MUST order by
/// `created_at DESC, uri DESC` so the predicate and sort agree. Legacy
/// single-value cursors (no `|`) fall back to the timestamp-only predicate.
fn push_keyset_cursor(qb: &mut QueryBuilder<Postgres>, cursor: &str) {
    match cursor.split_once('|') {
        Some((created_at, uri)) => {
            qb.push(" AND (created_at, uri) < (");
            qb.push_bind(created_at.to_string());
            qb.push("::timestamptz, ");
            qb.push_bind(uri.to_string());
            qb.push(")");
        }
        None => {
            qb.push(" AND created_at < ");
            qb.push_bind(cursor.to_string());
            qb.push("::timestamptz");
        }
    }
}

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

    // Filter by the consensus taxon's kingdom (via community_ids → taxa)
    // rather than the submitter's `occurrences.kingdom`. Submitters often
    // skip ancestry columns, so the old direct filter dropped legitimate
    // observations whose community ID resolves under the requested kingdom.
    if let Some(kingdom) = options.kingdom.as_deref() {
        qb.push(" AND ");
        push_consensus_rank_filter(&mut qb, "kingdom", kingdom);
    }

    if let Some(start_date) = options.start_date.as_deref() {
        qb.push(" AND event_date >= ");
        qb.push_bind(start_date);
    }

    if let Some(end_date) = options.end_date.as_deref() {
        qb.push(" AND event_date <= ");
        qb.push_bind(end_date);
    }

    if !options.quality.is_empty() {
        push_quality_filter(&mut qb, &options.quality.criteria);
    }

    if let Some(cursor) = options.cursor.as_deref() {
        push_keyset_cursor(&mut qb, cursor);
    }

    let limit = options.limit.unwrap_or(20);
    qb.push(" ORDER BY created_at DESC, uri DESC LIMIT ");
    qb.push_bind(limit);

    qb.build_query_as::<OccurrenceRow>()
        .fetch_all(executor)
        .await
}

/// Push one WHERE clause per requested criterion. Each clause matches the
/// corresponding branch of [`crate::quality::compute_issues`] — i.e. the row
/// is kept only when that quality issue would be absent. Keep the two in sync:
/// requesting every criterion must select exactly the "no issues" rows.
fn push_quality_filter(qb: &mut QueryBuilder<Postgres>, criteria: &[QualityCriterion]) {
    for criterion in criteria {
        match criterion {
            QualityCriterion::HasDate => {
                qb.push(" AND event_date IS NOT NULL");
            }
            QualityCriterion::HasLocation => {
                qb.push(" AND location IS NOT NULL");
            }
            QualityCriterion::PreciseLocation => {
                // Precision implies a location is present, mirroring
                // compute_issues suppressing CoordinatesImprecise when the
                // coordinates are missing entirely.
                qb.push(" AND location IS NOT NULL");
                qb.push(" AND coordinate_uncertainty_meters IS NOT NULL");
                qb.push(" AND coordinate_uncertainty_meters <= ");
                qb.push_bind(IMPRECISE_UNCERTAINTY_THRESHOLD_M);
            }
            QualityCriterion::HasMedia => {
                qb.push(" AND COALESCE(jsonb_array_length(associated_media), 0) > 0");
            }
            QualityCriterion::HasConsensusId => {
                qb.push(
                    " AND EXISTS (SELECT 1 FROM community_ids ci WHERE ci.occurrence_uri = occurrences.uri)",
                );
            }
        }
    }
}

/// Get the profile feed for a user
pub async fn get_profile_feed(
    pool: &PgPool,
    did: &str,
    options: &ProfileFeedOptions,
) -> Result<ProfileFeedResult, sqlx::Error> {
    let limit = options.limit.unwrap_or(20);
    let feed_type = options.feed_type.as_ref().cloned().unwrap_or_default();

    let counts_row: (i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            (SELECT COUNT(*) FROM occurrences WHERE did = $1),
            (SELECT COUNT(*) FROM identifications WHERE did = $1),
            (SELECT COUNT(DISTINCT (scientific_name, kingdom)) FROM occurrences
             WHERE did = $1 AND scientific_name IS NOT NULL)
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
                SELECT
                    uri, cid, did, scientific_name,
                    event_date_raw as event_date,
                    ST_Y(location::geometry) as latitude,
                    ST_X(location::geometry) as longitude,
                    coordinate_uncertainty_meters,
                    associated_media, recorded_by,
                    taxon_id, taxon_rank, kingdom, phylum, class, "order" as order_, family, genus,
                    organism_quantity, organism_quantity_type,
                    created_at,
                    NULL::float8 as distance_meters,
                    NULL::text as source
                FROM occurrences
                WHERE did = $1 AND created_at < ($3::text)::timestamptz
                ORDER BY created_at DESC, uri DESC
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
                SELECT
                    uri, cid, did, scientific_name,
                    event_date_raw as event_date,
                    ST_Y(location::geometry) as latitude,
                    ST_X(location::geometry) as longitude,
                    coordinate_uncertainty_meters,
                    associated_media, recorded_by,
                    taxon_id, taxon_rank, kingdom, phylum, class, "order" as order_, family, genus,
                    organism_quantity, organism_quantity_type,
                    created_at,
                    NULL::float8 as distance_meters,
                    NULL::text as source
                FROM occurrences
                WHERE did = $1
                ORDER BY created_at DESC, uri DESC
                LIMIT $2
                "#,
                did,
                limit,
            )
            .fetch_all(pool)
            .await?
        };
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
                    identification_verification_status, type_status, date_identified,
                    kingdom, phylum, class, "order" as order_, family, genus
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
                    identification_verification_status, type_status, date_identified,
                    kingdom, phylum, class, "order" as order_, family, genus
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

    if !options.quality.is_empty() {
        push_quality_filter(&mut qb, &options.quality.criteria);
    }

    if let Some(cursor) = options.cursor.as_deref() {
        push_keyset_cursor(&mut qb, cursor);
    }

    let limit = options.limit.unwrap_or(20);
    qb.push(" ORDER BY created_at DESC, uri DESC LIMIT ");
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

    push_consensus_rank_filter(&mut qb, &rank_lower, taxon_name);

    if !hidden_dids.is_empty() {
        qb.push(" AND did != ALL(");
        qb.push_bind(hidden_dids.to_vec());
        qb.push(")");
    }

    if let Some(kingdom) = options.kingdom.as_deref() {
        if rank_lower != "kingdom" {
            qb.push(" AND ");
            push_consensus_rank_filter(&mut qb, "kingdom", kingdom);
        }
    }

    if let Some(cursor) = options.cursor.as_deref() {
        push_keyset_cursor(&mut qb, cursor);
    }

    qb.push(" ORDER BY created_at DESC, uri DESC LIMIT ");
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

    push_consensus_rank_filter(&mut qb, &rank_lower, taxon_name);

    if let Some(kingdom) = kingdom {
        if rank_lower != "kingdom" {
            qb.push(" AND ");
            push_consensus_rank_filter(&mut qb, "kingdom", kingdom);
        }
    }

    let (count,): (i64,) = qb.build_query_as().fetch_one(executor).await?;
    Ok(count)
}

/// Restrict the outer occurrences query to rows whose consensus
/// identification places them at `taxon_name` for the given rank.
///
/// Uses `community_ids` (one row per occurrence, the winning vote) joined
/// to `taxa` so the rank columns reflect the canonical Linnaean ancestry,
/// not whatever the submitter typed into their occurrence record.
/// Submitters routinely leave higher-rank columns blank, so filtering on
/// `occurrences.kingdom` directly drops legitimate observations.
fn push_consensus_rank_filter(qb: &mut QueryBuilder<Postgres>, rank_lower: &str, taxon_name: &str) {
    let column = match rank_lower {
        "species" | "subspecies" | "variety" => "t.species",
        "genus" => "t.genus",
        "family" => "t.family",
        "order" => "t.\"order\"",
        "class" => "t.class",
        "phylum" => "t.phylum",
        "kingdom" => "t.kingdom",
        _ => "t.scientific_name",
    };
    qb.push("uri IN (SELECT ci.occurrence_uri FROM community_ids ci JOIN taxa t ON t.taxon_key = ci.accepted_taxon_key WHERE ");
    qb.push(column);
    qb.push(" = ");
    qb.push_bind(taxon_name);
    qb.push(")");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyset_cursor_compound_uses_row_value_comparison() {
        let mut qb = QueryBuilder::<Postgres>::new("SELECT 1 FROM occurrences WHERE TRUE");
        push_keyset_cursor(&mut qb, "2026-06-02T21:13:49Z|at://did:plc:x/coll/rkey");
        let sql = qb.sql();
        let sql = sql.as_str();
        // Tuple comparison against (created_at, uri) so a shared timestamp can't
        // skip or duplicate rows at the page boundary.
        assert!(sql.contains("(created_at, uri) < ("), "got: {sql}");
        assert!(sql.contains("::timestamptz"));
    }

    #[test]
    fn keyset_cursor_legacy_value_falls_back_to_timestamp() {
        let mut qb = QueryBuilder::<Postgres>::new("SELECT 1 FROM occurrences WHERE TRUE");
        push_keyset_cursor(&mut qb, "2026-06-02T21:13:49Z");
        let sql = qb.sql();
        let sql = sql.as_str();
        // A pre-upgrade cursor (no `|`) still paginates, just without the tiebreaker.
        assert!(sql.contains("AND created_at < "), "got: {sql}");
        assert!(!sql.contains("(created_at, uri)"), "got: {sql}");
    }
}
