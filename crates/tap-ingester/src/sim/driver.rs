//! The seam between the model and the real system.
//!
//! [`Driver`] is the in-process shape of the language-agnostic protocol in
//! `docs/system-tests.md` (reset / apply / quiesce / snapshot). [`PgDriver`]
//! implements it against a scratch Postgres database using the ingester's
//! real write path ([`crate::apply_record`]).

use std::error::Error;

use observing_db::identifications::refresh_community_ids;
use sqlx::postgres::PgPool;
use sqlx::AssertSqlSafe;

use super::model::{fake_taxon_key, Event, IdentificationRow, Snapshot};
use crate::database::Database;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

pub trait Driver {
    /// Return to an empty system.
    async fn reset(&mut self) -> Result<()>;
    /// Feed one firehose event through the ingester. `Err` is the ingester
    /// rejecting the event, which the sim treats as a finding, not a crash.
    async fn ingest(&mut self, event: &Event) -> std::result::Result<(), String>;
    /// Run the resolve-taxa background worker once.
    async fn resolve_taxa(&mut self) -> Result<()>;
    /// Map the real database into the model's vocabulary.
    async fn snapshot(&mut self) -> Result<Snapshot>;
}

/// Runs against a throwaway database created (and migrated) on the server at
/// `SIM_DATABASE_URL`, so it never touches a dev database's data.
pub struct PgDriver {
    db: Database,
    server: PgPool,
    name: String,
}

impl PgDriver {
    pub async fn create(server_url: &str) -> Result<Self> {
        let server = PgPool::connect(server_url).await?;
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .subsec_nanos();
        let name = format!("observing_sim_{}_{nanos}", std::process::id());
        sqlx::query(AssertSqlSafe(format!("CREATE DATABASE \"{name}\"")))
            .execute(&server)
            .await?;

        let mut url = url::Url::parse(server_url)?;
        url.set_path(&name);
        // Migrate on a separate pool: the migrations set the database-level
        // search_path, which only applies to connections opened afterwards.
        let migrate_pool = PgPool::connect(url.as_str()).await?;
        observing_db::migrate::migrate(&migrate_pool).await?;
        migrate_pool.close().await;

        let db = Database::connect(url.as_str()).await?;
        Ok(Self { db, server, name })
    }

    pub async fn destroy(self) -> Result<()> {
        self.db.pool().close().await;
        sqlx::query(AssertSqlSafe(format!(
            "DROP DATABASE \"{}\" WITH (FORCE)",
            self.name
        )))
        .execute(&self.server)
        .await?;
        Ok(())
    }

    fn pool(&self) -> &PgPool {
        self.db.pool()
    }
}

impl Driver for PgDriver {
    async fn reset(&mut self) -> Result<()> {
        sqlx::query(
            "TRUNCATE occurrences, identifications, comments, likes, interactions, \
             notifications, failed_records CASCADE",
        )
        .execute(self.pool())
        .await?;
        Ok(())
    }

    async fn ingest(&mut self, event: &Event) -> std::result::Result<(), String> {
        crate::apply_record(
            &self.db,
            event.did,
            event.collection,
            &event.uri,
            event.action,
            event.cid.as_deref(),
            event.record.clone(),
        )
        .await
        .map(|_| ())
        .map_err(|e| format!("{} {:?}: {e}", event.uri, event.action))
    }

    /// Mirrors `observing-resolve-taxa`'s name pass with a fake GBIF upstream.
    /// The SQL is copied from that worker; extracting it into `observing-db`
    /// would let the sim run the real code instead.
    async fn resolve_taxa(&mut self) -> Result<()> {
        let pairs: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT DISTINCT scientific_name, kingdom FROM identifications \
             WHERE accepted_taxon_key IS NULL AND scientific_name <> ''",
        )
        .fetch_all(self.pool())
        .await?;
        for (name, kingdom) in pairs {
            sqlx::query(
                "UPDATE identifications SET accepted_taxon_key = $1, indexed_at = NOW() \
                 WHERE accepted_taxon_key IS NULL AND scientific_name = $2 \
                   AND ($3::text IS NULL OR kingdom = $3)",
            )
            .bind(fake_taxon_key(&name))
            .bind(&name)
            .bind(kingdom.as_deref())
            .execute(self.pool())
            .await?;
        }
        Ok(())
    }

    async fn snapshot(&mut self) -> Result<Snapshot> {
        let pool = self.pool();
        refresh_community_ids(pool).await?;
        let mut s = Snapshot {
            occurrences: sqlx::query_scalar("SELECT uri FROM occurrences")
                .fetch_all(pool)
                .await?
                .into_iter()
                .collect(),
            likes: sqlx::query_as("SELECT did, subject_uri FROM likes")
                .fetch_all(pool)
                .await?
                .into_iter()
                .collect(),
            community_ids: sqlx::query_as::<_, (String, String, i64)>(
                "SELECT occurrence_uri, scientific_name, id_count FROM community_ids",
            )
            .fetch_all(pool)
            .await?
            .into_iter()
            .map(|(uri, name, count)| (uri, (name, count)))
            .collect(),
            duplicate_notifications: sqlx::query_as::<_, (String, String, Option<String>, i64)>(
                "SELECT actor_did, kind, reference_uri, COUNT(*) FROM notifications \
                 GROUP BY 1, 2, 3 HAVING COUNT(*) > 1",
            )
            .fetch_all(pool)
            .await?
            .into_iter()
            .map(|(actor, kind, reference, n)| ((actor, kind, reference), n))
            .collect(),
            ..Default::default()
        };

        type IdRow = (
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<i64>,
        );
        let rows: Vec<IdRow> = sqlx::query_as(
            "SELECT uri, subject_uri, scientific_name, taxon_rank, kingdom, accepted_taxon_key \
             FROM identifications",
        )
        .fetch_all(pool)
        .await?;
        for (uri, subject, name, rank, kingdom, key) in rows {
            s.accepted_taxon_keys.insert(uri.clone(), key);
            s.identifications.insert(
                uri,
                IdentificationRow {
                    subject,
                    name,
                    rank,
                    kingdom,
                },
            );
        }
        Ok(s)
    }
}
