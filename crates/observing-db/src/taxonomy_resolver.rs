//! Cache-backed taxonomy resolver.
//!
//! Fronts the `taxa` table with a write-through cache pattern: lookups hit
//! the local cache first; on miss, an injected upstream source produces the
//! target taxon plus its ancestor chain, which the resolver persists before
//! returning the target.
//!
//! Both the upstream and the cache are abstracted behind traits so the
//! orchestration here is independently testable. The GBIF-backed upstream
//! lives in `observing-appview`; the production cache impl is over
//! `sqlx::PgPool` (provided in this module).

use crate::taxa::{self, TaxonRow};
use std::fmt;

/// Errors surfaced by the resolver.
#[derive(Debug)]
pub enum ResolveError {
    /// Database access failed (cache lookup, upsert, …).
    Cache(sqlx::Error),
    /// The upstream taxonomy source failed (HTTP, parse, …).
    Upstream(String),
}

impl fmt::Display for ResolveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cache(e) => write!(f, "taxonomy cache: {e}"),
            Self::Upstream(e) => write!(f, "taxonomy upstream: {e}"),
        }
    }
}

impl std::error::Error for ResolveError {}

impl From<sqlx::Error> for ResolveError {
    fn from(e: sqlx::Error) -> Self {
        Self::Cache(e)
    }
}

/// A target taxon plus the ancestors needed to populate its denormalized
/// classification, normalized to the shape of `taxa` rows so the resolver
/// can persist them without further translation.
///
/// `target_key` identifies which row in `rows` is the queried taxon —
/// ancestors come along so the cache is warmed in one shot.
#[derive(Debug, Clone)]
pub struct UpstreamMatch {
    pub target_key: i64,
    pub rows: Vec<TaxonRow>,
}

/// External taxonomy source the resolver delegates to on cache miss.
pub trait TaxonomyUpstream {
    fn match_name(
        &self,
        scientific_name: &str,
        kingdom_hint: Option<&str>,
    ) -> impl std::future::Future<Output = Result<Option<UpstreamMatch>, ResolveError>> + Send;

    fn get_by_key(
        &self,
        taxon_key: i64,
    ) -> impl std::future::Future<Output = Result<Option<UpstreamMatch>, ResolveError>> + Send;
}

/// Local cache the resolver consults before reaching for the upstream.
pub trait TaxonomyCache {
    fn get_by_name(
        &self,
        scientific_name: &str,
        kingdom_hint: Option<&str>,
    ) -> impl std::future::Future<Output = Result<Option<TaxonRow>, sqlx::Error>> + Send;

    fn get_by_key(
        &self,
        taxon_key: i64,
    ) -> impl std::future::Future<Output = Result<Option<TaxonRow>, sqlx::Error>> + Send;

    fn upsert_many(
        &self,
        rows: &[TaxonRow],
    ) -> impl std::future::Future<Output = Result<(), sqlx::Error>> + Send;
}

/// Production cache impl backed by Postgres via the [`crate::taxa`] module.
impl TaxonomyCache for sqlx::PgPool {
    async fn get_by_name(
        &self,
        scientific_name: &str,
        kingdom_hint: Option<&str>,
    ) -> Result<Option<TaxonRow>, sqlx::Error> {
        taxa::get_by_name(self, scientific_name, kingdom_hint).await
    }

    async fn get_by_key(&self, taxon_key: i64) -> Result<Option<TaxonRow>, sqlx::Error> {
        taxa::get_by_key(self, taxon_key).await
    }

    async fn upsert_many(&self, rows: &[TaxonRow]) -> Result<(), sqlx::Error> {
        taxa::upsert_many(self, rows).await
    }
}

/// Cache-backed taxon resolver. Looks up the local cache first; on miss,
/// queries `upstream`, persists the returned rows, and returns the target.
pub struct Resolver<'a, C: TaxonomyCache, U: TaxonomyUpstream> {
    cache: &'a C,
    upstream: &'a U,
}

impl<'a, C: TaxonomyCache, U: TaxonomyUpstream> Resolver<'a, C, U> {
    pub fn new(cache: &'a C, upstream: &'a U) -> Self {
        Self { cache, upstream }
    }

    /// Resolve by scientific name with an optional kingdom hint. Returns
    /// `Ok(None)` if upstream has no match for the name.
    pub async fn resolve_by_name(
        &self,
        scientific_name: &str,
        kingdom_hint: Option<&str>,
    ) -> Result<Option<TaxonRow>, ResolveError> {
        if let Some(row) = self
            .cache
            .get_by_name(scientific_name, kingdom_hint)
            .await?
        {
            return Ok(Some(row));
        }
        let Some(m) = self
            .upstream
            .match_name(scientific_name, kingdom_hint)
            .await?
        else {
            return Ok(None);
        };
        let target_key = m.target_key;
        self.cache.upsert_many(&m.rows).await?;
        Ok(m.rows.into_iter().find(|r| r.taxon_key == target_key))
    }

    /// Resolve by GBIF usageKey.
    pub async fn resolve_by_key(&self, taxon_key: i64) -> Result<Option<TaxonRow>, ResolveError> {
        if let Some(row) = self.cache.get_by_key(taxon_key).await? {
            return Ok(Some(row));
        }
        let Some(m) = self.upstream.get_by_key(taxon_key).await? else {
            return Ok(None);
        };
        let target_key = m.target_key;
        self.cache.upsert_many(&m.rows).await?;
        Ok(m.rows.into_iter().find(|r| r.taxon_key == target_key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use std::sync::Mutex;

    fn make_row(taxon_key: i64, name: &str, kingdom: Option<&str>, status: &str) -> TaxonRow {
        TaxonRow {
            taxon_key,
            scientific_name: name.to_string(),
            authorship: None,
            rank: "species".to_string(),
            status: status.to_string(),
            accepted_taxon_key: Some(taxon_key),
            parent_key: None,
            kingdom: kingdom.map(str::to_string),
            kingdom_key: None,
            phylum: None,
            phylum_key: None,
            class: None,
            class_key: None,
            order_: None,
            order_key: None,
            family: None,
            family_key: None,
            genus: None,
            genus_key: None,
            species: None,
            species_key: None,
            vernacular_name: None,
            extinct: None,
            fetched_at: Utc::now(),
            source: "test".to_string(),
        }
    }

    #[derive(Default)]
    struct FakeCache {
        rows: Mutex<Vec<TaxonRow>>,
        upsert_calls: Mutex<u32>,
        lookup_calls: Mutex<u32>,
    }

    impl FakeCache {
        fn seeded(rows: Vec<TaxonRow>) -> Self {
            Self {
                rows: Mutex::new(rows),
                ..Default::default()
            }
        }

        fn upserts(&self) -> u32 {
            *self.upsert_calls.lock().unwrap()
        }

        fn lookups(&self) -> u32 {
            *self.lookup_calls.lock().unwrap()
        }
    }

    impl TaxonomyCache for FakeCache {
        async fn get_by_name(
            &self,
            name: &str,
            kingdom_hint: Option<&str>,
        ) -> Result<Option<TaxonRow>, sqlx::Error> {
            *self.lookup_calls.lock().unwrap() += 1;
            let rows = self.rows.lock().unwrap();
            // Mirror the real query's preference for ACCEPTED then lowest key.
            let mut matches: Vec<&TaxonRow> = rows
                .iter()
                .filter(|r| r.scientific_name.eq_ignore_ascii_case(name))
                .filter(|r| match kingdom_hint {
                    Some(k) => r.kingdom.as_deref() == Some(k),
                    None => true,
                })
                .collect();
            matches.sort_by_key(|r| (r.status != "ACCEPTED", r.taxon_key));
            Ok(matches.into_iter().next().cloned())
        }

        async fn get_by_key(&self, taxon_key: i64) -> Result<Option<TaxonRow>, sqlx::Error> {
            *self.lookup_calls.lock().unwrap() += 1;
            let rows = self.rows.lock().unwrap();
            Ok(rows.iter().find(|r| r.taxon_key == taxon_key).cloned())
        }

        async fn upsert_many(&self, rows: &[TaxonRow]) -> Result<(), sqlx::Error> {
            *self.upsert_calls.lock().unwrap() += 1;
            let mut store = self.rows.lock().unwrap();
            for incoming in rows {
                if let Some(existing) = store.iter_mut().find(|r| r.taxon_key == incoming.taxon_key)
                {
                    *existing = incoming.clone();
                } else {
                    store.push(incoming.clone());
                }
            }
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeUpstream {
        by_name: std::collections::HashMap<String, UpstreamMatch>,
        by_key: std::collections::HashMap<i64, UpstreamMatch>,
        name_calls: Mutex<u32>,
        key_calls: Mutex<u32>,
        upstream_error: Option<String>,
    }

    impl FakeUpstream {
        fn name_calls(&self) -> u32 {
            *self.name_calls.lock().unwrap()
        }
    }

    impl TaxonomyUpstream for FakeUpstream {
        async fn match_name(
            &self,
            name: &str,
            _kingdom_hint: Option<&str>,
        ) -> Result<Option<UpstreamMatch>, ResolveError> {
            *self.name_calls.lock().unwrap() += 1;
            if let Some(err) = &self.upstream_error {
                return Err(ResolveError::Upstream(err.clone()));
            }
            Ok(self.by_name.get(&name.to_lowercase()).cloned())
        }

        async fn get_by_key(&self, taxon_key: i64) -> Result<Option<UpstreamMatch>, ResolveError> {
            *self.key_calls.lock().unwrap() += 1;
            if let Some(err) = &self.upstream_error {
                return Err(ResolveError::Upstream(err.clone()));
            }
            Ok(self.by_key.get(&taxon_key).cloned())
        }
    }

    #[tokio::test]
    async fn cache_hit_skips_upstream() {
        let cache = FakeCache::seeded(vec![make_row(
            1,
            "Quercus alba",
            Some("Plantae"),
            "ACCEPTED",
        )]);
        let upstream = FakeUpstream::default();
        let resolver = Resolver::new(&cache, &upstream);

        let row = resolver
            .resolve_by_name("Quercus alba", Some("Plantae"))
            .await
            .unwrap()
            .unwrap();

        assert_eq!(row.taxon_key, 1);
        assert_eq!(upstream.name_calls(), 0);
        assert_eq!(cache.upserts(), 0);
    }

    #[tokio::test]
    async fn cache_miss_writes_through() {
        let cache = FakeCache::default();
        let mut upstream = FakeUpstream::default();
        let target = make_row(1, "Quercus alba", Some("Plantae"), "ACCEPTED");
        let ancestor = make_row(0, "Plantae", None, "ACCEPTED");
        upstream.by_name.insert(
            "quercus alba".to_string(),
            UpstreamMatch {
                target_key: 1,
                rows: vec![target.clone(), ancestor.clone()],
            },
        );
        let resolver = Resolver::new(&cache, &upstream);

        let row = resolver
            .resolve_by_name("Quercus alba", Some("Plantae"))
            .await
            .unwrap()
            .unwrap();

        assert_eq!(row.taxon_key, 1);
        // Ancestor written too so subsequent rank filters hit the cache.
        assert_eq!(cache.rows.lock().unwrap().len(), 2);
        assert_eq!(upstream.name_calls(), 1);
        assert_eq!(cache.upserts(), 1);
    }

    #[tokio::test]
    async fn second_lookup_after_miss_skips_upstream() {
        let cache = FakeCache::default();
        let mut upstream = FakeUpstream::default();
        upstream.by_name.insert(
            "quercus alba".to_string(),
            UpstreamMatch {
                target_key: 1,
                rows: vec![make_row(1, "Quercus alba", Some("Plantae"), "ACCEPTED")],
            },
        );
        let resolver = Resolver::new(&cache, &upstream);

        resolver
            .resolve_by_name("Quercus alba", Some("Plantae"))
            .await
            .unwrap();
        resolver
            .resolve_by_name("Quercus alba", Some("Plantae"))
            .await
            .unwrap();

        assert_eq!(upstream.name_calls(), 1);
        assert_eq!(cache.upserts(), 1);
        assert_eq!(cache.lookups(), 2);
    }

    #[tokio::test]
    async fn upstream_no_match_returns_none() {
        let cache = FakeCache::default();
        let upstream = FakeUpstream::default();
        let resolver = Resolver::new(&cache, &upstream);

        let result = resolver.resolve_by_name("Nonexistens fakeii", None).await;

        assert!(matches!(result, Ok(None)));
        assert_eq!(upstream.name_calls(), 1);
        assert_eq!(cache.upserts(), 0);
    }

    #[tokio::test]
    async fn resolve_by_key_cache_hit() {
        let cache = FakeCache::seeded(vec![make_row(42, "Foo bar", None, "ACCEPTED")]);
        let upstream = FakeUpstream::default();
        let resolver = Resolver::new(&cache, &upstream);

        let row = resolver.resolve_by_key(42).await.unwrap().unwrap();
        assert_eq!(row.taxon_key, 42);
        assert_eq!(upstream.name_calls(), 0);
    }

    #[tokio::test]
    async fn synonym_returns_synonym_row_with_accepted_pointer() {
        // Cache contains both an accepted taxon and one of its synonyms; a
        // by-name lookup of the synonym should return the synonym row, with
        // accepted_taxon_key pointing at the accepted record. Callers that
        // want the accepted taxon recurse via resolve_by_key.
        let mut accepted = make_row(1, "Quercus robur", Some("Plantae"), "ACCEPTED");
        accepted.accepted_taxon_key = Some(1);
        let mut synonym = make_row(2, "Quercus pedunculata", Some("Plantae"), "SYNONYM");
        synonym.accepted_taxon_key = Some(1);

        let cache = FakeCache::seeded(vec![accepted, synonym]);
        let upstream = FakeUpstream::default();
        let resolver = Resolver::new(&cache, &upstream);

        let row = resolver
            .resolve_by_name("Quercus pedunculata", Some("Plantae"))
            .await
            .unwrap()
            .unwrap();

        assert_eq!(row.taxon_key, 2);
        assert_eq!(row.status, "SYNONYM");
        assert_eq!(row.accepted_taxon_key, Some(1));
    }

    #[tokio::test]
    async fn upstream_error_propagates() {
        let cache = FakeCache::default();
        let upstream = FakeUpstream {
            upstream_error: Some("boom".into()),
            ..Default::default()
        };
        let resolver = Resolver::new(&cache, &upstream);

        let result = resolver.resolve_by_name("Quercus alba", None).await;

        assert!(matches!(result, Err(ResolveError::Upstream(_))));
        assert_eq!(cache.upserts(), 0);
    }
}
