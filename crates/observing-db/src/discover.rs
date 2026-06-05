//! Queries backing the discovery surfaces (e.g. "what could you find near
//! here"). These don't map to a single AT Protocol record type, so they live
//! in their own module.

use sqlx::PgPool;

/// A user's "life list": the distinct `(scientific_name, kingdom)` pairs they
/// have personally observed. Used to subtract already-found species from the
/// in-range set so the "to find" list only shows what they're missing.
///
/// Returned raw (not normalized) — the caller owns the match-key normalization
/// so it stays identical on both sides of the subtraction. Uses the runtime
/// query API (not the `query!` macro) so it needs no offline `.sqlx` cache
/// entry.
pub async fn life_list(
    pool: &PgPool,
    did: &str,
) -> Result<Vec<(String, Option<String>)>, sqlx::Error> {
    sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT DISTINCT scientific_name, kingdom FROM occurrences WHERE did = $1",
    )
    .bind(did)
    .fetch_all(pool)
    .await
}
