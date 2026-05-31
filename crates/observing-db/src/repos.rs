//! Repo-level queries for the ingester admin surface.

use crate::PgPool;

/// Distinct DIDs that have produced any ingested lexicon record, unioned
/// across the five collections the ingester writes (occurrences,
/// identifications, comments, interactions, likes).
///
/// This is the set of repos Tap is expected to be tracking — the ingester
/// dashboard enriches each one with its live Tap `repo_info` state so the
/// admin can spot a repo that's stuck (e.g. `resyncing`/`error`) or whose
/// record count diverges from what's on its PDS.
///
/// Uses the runtime query API rather than the `sqlx::query!` macro on purpose:
/// it's a fixed, parameter-less, admin-only read, so skipping the macro avoids
/// a `.sqlx` offline-cache entry (and the DB-backed `cargo sqlx prepare` churn)
/// for what is effectively a diagnostic.
pub async fn tracked_dids(pool: &PgPool) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT did FROM occurrences \
         UNION SELECT did FROM identifications \
         UNION SELECT did FROM comments \
         UNION SELECT did FROM interactions \
         UNION SELECT did FROM likes \
         ORDER BY did",
    )
    .fetch_all(pool)
    .await
}
