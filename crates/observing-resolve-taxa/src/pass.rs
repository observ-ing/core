//! One resolution walk over the identifications that still need a key.
//!
//! The walk has two phases: resolve by `(scientific_name, kingdom)`, then mop
//! up rows that carry a `taxon_id` URI. Each phase goes through its work in a
//! fixed order, so a walk cut short by a deadline returns a [`Cursor`] and a
//! later call picks up after the last item it handled. Rows resolved in the
//! meantime simply drop out of the set.

use std::time::{Duration, Instant};

use observing_db::taxon_uri::{self, TaxonRef};
use observing_db::taxonomy_resolver::{ResolveError, Resolver};
use observing_taxonomy_gbif::GbifUpstream;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use tracing::{info, warn};
use wikidata_client::WikidataClient;

/// Wikidata property id for an iNaturalist taxon.
const WIKIDATA_INATURALIST_PROPERTY: &str = "P3151";

/// Where a walk starts, or where a cut-short one stopped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum Cursor {
    /// Resolving by name, after `after` if set.
    Names {
        #[serde(default)]
        after: Option<NameKey>,
    },
    /// Resolving by `taxon_id` URI, after `after` if set.
    TaxonIds {
        #[serde(default)]
        after: Option<String>,
    },
}

impl Default for Cursor {
    fn default() -> Self {
        Cursor::Names { after: None }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NameKey {
    pub scientific_name: String,
    pub kingdom: Option<String>,
}

pub struct Options {
    /// Pause between lookups, to be polite to GBIF.
    pub rate_limit: Duration,
    /// Cap on the items each phase takes on.
    pub limit: Option<i64>,
    /// Log what would be resolved without calling GBIF or writing.
    pub dry_run: bool,
    /// Stop after the item in progress at this time. `None` runs to the end.
    pub deadline: Option<Instant>,
}

impl Options {
    fn past_deadline(&self) -> bool {
        self.deadline.is_some_and(|d| Instant::now() >= d)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Complete,
    /// Hit the deadline. Pass the cursor to the next walk to carry on.
    Paused(Cursor),
}

#[derive(Debug)]
pub struct Report {
    pub outcome: Outcome,
    /// Identifications that got a key.
    pub updated_rows: u64,
}

/// What a walk talks to.
pub struct Clients {
    pub pool: PgPool,
    pub gbif: GbifUpstream,
    pub wikidata: WikidataClient,
}

impl Clients {
    /// Walk from `from`, then refresh the `community_ids` matview if any
    /// identification got a key.
    pub async fn walk(&self, from: Cursor, opts: &Options) -> Result<Report, sqlx::Error> {
        let resolver = Resolver::new(&self.pool, &self.gbif);
        let mut updated_rows = 0;
        let outcome = self
            .walk_phases(&resolver, from, opts, &mut updated_rows)
            .await?;

        // One matview refresh covers both phases.
        if updated_rows > 0 && !opts.dry_run {
            info!(updated_rows, "Refreshing community_ids");
            observing_db::identifications::refresh_community_ids(&self.pool).await?;
        }
        Ok(Report {
            outcome,
            updated_rows,
        })
    }

    async fn walk_phases(
        &self,
        resolver: &Resolver<'_, PgPool, GbifUpstream>,
        from: Cursor,
        opts: &Options,
        updated_rows: &mut u64,
    ) -> Result<Outcome, sqlx::Error> {
        let after_uri = match from {
            Cursor::Names { after } => {
                if let Some(stopped) = self
                    .name_phase(resolver, after.as_ref(), opts, updated_rows)
                    .await?
                {
                    return Ok(Outcome::Paused(Cursor::Names {
                        after: Some(stopped),
                    }));
                }
                None
            }
            Cursor::TaxonIds { after } => after,
        };
        if let Some(stopped) = self
            .taxon_id_phase(resolver, after_uri.as_deref(), opts, updated_rows)
            .await?
        {
            return Ok(Outcome::Paused(Cursor::TaxonIds {
                after: Some(stopped),
            }));
        }
        Ok(Outcome::Complete)
    }

    /// Resolve unresolved identifications by `(scientific_name, kingdom)`.
    /// Returns the last pair handled if the deadline cut the phase short.
    async fn name_phase(
        &self,
        resolver: &Resolver<'_, PgPool, GbifUpstream>,
        after: Option<&NameKey>,
        opts: &Options,
        updated_rows: &mut u64,
    ) -> Result<Option<NameKey>, sqlx::Error> {
        // Distinct pairs that still need a key, in the order the cursor walks.
        // Pulled in one shot; if the backlog ever outgrows memory, page
        // through the same set instead.
        let pairs: Vec<NameKey> = sqlx::query(
            r#"SELECT DISTINCT scientific_name, kingdom
               FROM identifications
               WHERE accepted_taxon_key IS NULL
                 AND scientific_name <> ''
                 AND ($1::text IS NULL
                      OR scientific_name > $1
                      OR (scientific_name = $1
                          AND kingdom IS NOT NULL
                          AND ($2::text IS NULL OR kingdom > $2)))
               ORDER BY scientific_name, kingdom NULLS FIRST
               LIMIT $3"#,
        )
        .bind(after.map(|k| k.scientific_name.as_str()))
        .bind(after.and_then(|k| k.kingdom.as_deref()))
        .bind(opts.limit)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|r| NameKey {
            scientific_name: r.get("scientific_name"),
            kingdom: r.try_get("kingdom").ok(),
        })
        .collect();

        info!(
            pairs = pairs.len(),
            "Discovered (name, kingdom) pairs to resolve"
        );

        if opts.dry_run {
            for pair in &pairs {
                info!(name = %pair.scientific_name, kingdom = ?pair.kingdom, "Would resolve by name");
            }
            return Ok(None);
        }

        let mut tally = Tally::default();
        for (i, pair) in pairs.iter().enumerate() {
            let name = &pair.scientific_name;
            let kingdom = pair.kingdom.as_deref();
            match resolver.resolve_by_name(name, kingdom).await {
                Ok(Some(row)) => {
                    tally.resolved += 1;
                    let key = row.accepted_taxon_key.unwrap_or(row.taxon_key);
                    // Stamp every matching identification in one update. Uses
                    // the same (name, optional-kingdom) shape as resolution so
                    // multi-row hits share the cost.
                    let update = sqlx::query(
                        r#"UPDATE identifications
                           SET accepted_taxon_key = $1, indexed_at = NOW()
                           WHERE accepted_taxon_key IS NULL
                             AND scientific_name = $2
                             AND ($3::text IS NULL OR kingdom = $3)"#,
                    )
                    .bind(key)
                    .bind(name)
                    .bind(kingdom)
                    .execute(&self.pool)
                    .await;
                    match update {
                        Ok(res) => tally.updated_rows += res.rows_affected(),
                        Err(e) => {
                            tally.errors += 1;
                            warn!(name = %name, error = %e, "Failed to update identifications");
                        }
                    }
                }
                Ok(None) => tally.not_found += 1,
                Err(e) => {
                    tally.errors += 1;
                    warn!(name = %name, kingdom = ?kingdom, error = %e, "Resolve failed");
                }
            }

            if (i + 1) % 50 == 0 {
                tally.log_progress("Name-phase progress", i + 1, pairs.len());
            }
            if opts.past_deadline() && i + 1 < pairs.len() {
                tally.log_done("Name phase paused at deadline");
                *updated_rows += tally.updated_rows;
                return Ok(Some(pair.clone()));
            }
            rate_limit(opts).await;
        }

        tally.log_done("Name phase complete");
        *updated_rows += tally.updated_rows;
        Ok(None)
    }

    /// Mop up identifications that name resolution couldn't key but that
    /// carry a `taxon_id` URI: resolve the URI to a GBIF key directly and
    /// stamp it. Only touches rows still `accepted_taxon_key IS NULL`, so this
    /// is a strict fallback to the name phase. Returns the last URI handled if
    /// the deadline cut the phase short.
    async fn taxon_id_phase(
        &self,
        resolver: &Resolver<'_, PgPool, GbifUpstream>,
        after: Option<&str>,
        opts: &Options,
        updated_rows: &mut u64,
    ) -> Result<Option<String>, sqlx::Error> {
        let uris: Vec<String> = sqlx::query(
            r#"SELECT DISTINCT taxon_id
               FROM identifications
               WHERE accepted_taxon_key IS NULL
                 AND taxon_id IS NOT NULL
                 AND taxon_id <> ''
                 AND ($1::text IS NULL OR taxon_id > $1)
               ORDER BY taxon_id
               LIMIT $2"#,
        )
        .bind(after)
        .bind(opts.limit)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|r| r.get("taxon_id"))
        .collect();

        info!(uris = uris.len(), "Discovered taxon_id URIs to resolve");

        if opts.dry_run {
            for uri in &uris {
                info!(uri = %uri, parsed = ?taxon_uri::parse(uri), "Would resolve by URI");
            }
            return Ok(None);
        }

        let mut tally = Tally::default();
        for (i, uri) in uris.iter().enumerate() {
            match resolve_taxon_uri(uri, resolver, &self.wikidata).await {
                Ok(Some(key)) => {
                    tally.resolved += 1;
                    // Stamp every identification carrying this exact URI that
                    // the name phase left unresolved.
                    let update = sqlx::query(
                        r#"UPDATE identifications
                           SET accepted_taxon_key = $1, indexed_at = NOW()
                           WHERE accepted_taxon_key IS NULL
                             AND taxon_id = $2"#,
                    )
                    .bind(key)
                    .bind(uri)
                    .execute(&self.pool)
                    .await;
                    match update {
                        Ok(res) => tally.updated_rows += res.rows_affected(),
                        Err(e) => {
                            tally.errors += 1;
                            warn!(uri = %uri, error = %e, "Failed to update identifications");
                        }
                    }
                }
                Ok(None) => tally.not_found += 1,
                Err(e) => {
                    tally.errors += 1;
                    warn!(uri = %uri, error = %e, "taxon_id resolve failed");
                }
            }

            if (i + 1) % 50 == 0 {
                tally.log_progress("taxon_id-phase progress", i + 1, uris.len());
            }
            if opts.past_deadline() && i + 1 < uris.len() {
                tally.log_done("taxon_id phase paused at deadline");
                *updated_rows += tally.updated_rows;
                return Ok(Some(uri.clone()));
            }
            rate_limit(opts).await;
        }

        tally.log_done("taxon_id phase complete");
        *updated_rows += tally.updated_rows;
        Ok(None)
    }
}

#[derive(Default)]
struct Tally {
    resolved: u64,
    not_found: u64,
    errors: u64,
    updated_rows: u64,
}

impl Tally {
    fn log_progress(&self, message: &str, processed: usize, total: usize) {
        info!(
            processed,
            total,
            resolved = self.resolved,
            not_found = self.not_found,
            updated_rows = self.updated_rows,
            "{message}",
        );
    }

    fn log_done(&self, message: &str) {
        info!(
            resolved = self.resolved,
            not_found = self.not_found,
            errors = self.errors,
            updated_rows = self.updated_rows,
            "{message}",
        );
    }
}

/// Resolve a single `taxon_id` URI to a GBIF usage key. GBIF URIs carry the
/// key directly; iNaturalist / Wikidata URIs cross-walk to one through
/// Wikidata's external-ID properties. Returns `Ok(None)` for an unrecognized
/// URI, a missing cross-walk, or a key with no upstream match.
async fn resolve_taxon_uri(
    uri: &str,
    resolver: &Resolver<'_, PgPool, GbifUpstream>,
    wikidata: &WikidataClient,
) -> Result<Option<i64>, ResolveError> {
    let key = match taxon_uri::parse(uri) {
        TaxonRef::Gbif(key) => key,
        TaxonRef::INaturalist(id) => {
            match wikidata
                .gbif_key_for(WIKIDATA_INATURALIST_PROPERTY, &id)
                .await
            {
                Some(key) => key,
                None => {
                    warn!(uri = %uri, "No GBIF cross-walk for iNaturalist taxon_id");
                    return Ok(None);
                }
            }
        }
        TaxonRef::Wikidata(qid) => match wikidata.gbif_key_for_entity(&qid).await {
            Some(key) => key,
            None => {
                warn!(uri = %uri, "No GBIF cross-walk for Wikidata taxon_id");
                return Ok(None);
            }
        },
        TaxonRef::Unknown(u) => {
            warn!(uri = %u, "Unrecognized taxon_id URI; skipping");
            return Ok(None);
        }
    };

    match resolver.resolve_by_key(key).await? {
        Some(row) => Ok(Some(row.accepted_taxon_key.unwrap_or(row.taxon_key))),
        None => {
            warn!(uri = %uri, key, "taxon_id key not found upstream");
            Ok(None)
        }
    }
}

async fn rate_limit(opts: &Options) {
    if !opts.rate_limit.is_zero() {
        tokio::time::sleep(opts.rate_limit).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_empty_cursor_starts_at_the_name_phase() {
        let cursor: Cursor = serde_json::from_value(json!({ "phase": "names" })).unwrap();
        assert_eq!(cursor, Cursor::default());
    }

    #[test]
    fn cursors_round_trip_through_json() {
        for cursor in [
            Cursor::Names {
                after: Some(NameKey {
                    scientific_name: "Quercus alba".into(),
                    kingdom: None,
                }),
            },
            Cursor::Names {
                after: Some(NameKey {
                    scientific_name: "Quercus alba".into(),
                    kingdom: Some("Plantae".into()),
                }),
            },
            Cursor::TaxonIds {
                after: Some("https://www.gbif.org/species/2878688".into()),
            },
        ] {
            let json = serde_json::to_value(&cursor).unwrap();
            assert_eq!(serde_json::from_value::<Cursor>(json).unwrap(), cursor);
        }
    }

    #[test]
    fn taxon_id_cursors_are_tagged_by_phase() {
        assert_eq!(
            serde_json::to_value(Cursor::TaxonIds { after: None }).unwrap(),
            json!({ "phase": "taxon_ids", "after": null })
        );
    }
}
