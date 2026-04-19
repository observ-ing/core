-- Split tables into owner-labeled schemas.
--
-- Ingester is the single writer for lexicon-derived data; the appview owns
-- OAuth + private-location data and UPDATEs notifications.read. Moving the
-- tables into `ingester` / `appview` schemas makes that ownership visible in
-- every query, psql `\dt`, and admin tooling.
--
-- `sensitive_species`, `_sqlx_migrations`, and PostGIS's `spatial_ref_sys`
-- stay in `public` — they're shared/reference data not owned by either service.
--
-- The database-level `search_path` is set so existing unqualified queries
-- (`SELECT ... FROM occurrences`) continue to resolve. No Rust code changes.

CREATE SCHEMA IF NOT EXISTS ingester;
CREATE SCHEMA IF NOT EXISTS appview;

-- Ingester-owned: lexicon records + derived state.
ALTER TABLE IF EXISTS public.occurrences SET SCHEMA ingester;
ALTER TABLE IF EXISTS public.occurrence_observers SET SCHEMA ingester;
ALTER TABLE IF EXISTS public.identifications SET SCHEMA ingester;
ALTER TABLE IF EXISTS public.comments SET SCHEMA ingester;
ALTER TABLE IF EXISTS public.interactions SET SCHEMA ingester;
ALTER TABLE IF EXISTS public.likes SET SCHEMA ingester;
ALTER TABLE IF EXISTS public.notifications SET SCHEMA ingester;
ALTER TABLE IF EXISTS public.ingester_state SET SCHEMA ingester;
ALTER MATERIALIZED VIEW IF EXISTS public.community_ids SET SCHEMA ingester;

-- sqlx's migrations ledger must live in a schema that's on the post-migration
-- search_path AND matches `current_schema()` for new connections. Otherwise
-- sqlx's `CREATE TABLE IF NOT EXISTS _sqlx_migrations` on ingester startup
-- lands in an empty `ingester._sqlx_migrations`, thinks no migrations have
-- run, and tries to re-apply them all from scratch.
ALTER TABLE IF EXISTS public._sqlx_migrations SET SCHEMA ingester;

-- Appview-owned: OAuth + private location.
ALTER TABLE IF EXISTS public.occurrence_private_data SET SCHEMA appview;
ALTER TABLE IF EXISTS public.oauth_sessions SET SCHEMA appview;
ALTER TABLE IF EXISTS public.oauth_state SET SCHEMA appview;

-- Database-wide search_path so unqualified queries continue to resolve.
-- Applies to NEW connections; existing connections keep their old path and
-- may see brief "relation does not exist" errors until the pool reconnects.
DO $$
BEGIN
    EXECUTE format(
        'ALTER DATABASE %I SET search_path = ingester, appview, public',
        current_database()
    );
END
$$;

-- Make search_path available in the remainder of this session too (in case
-- another migration follows this one within the same connection).
SET search_path = ingester, appview, public;

-- Reissue grants per-schema. Supersedes the per-table grants from
-- 20260418000000_appview_reader_grants.sql. On local/CI where the role
-- doesn't exist, this is a no-op.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appview_reader') THEN
        RAISE NOTICE 'appview_reader role not found; skipping grants (expected on local/CI)';
        RETURN;
    END IF;

    -- Clean slate.
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM appview_reader';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ingester FROM appview_reader';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA appview FROM appview_reader';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM appview_reader';

    -- Schema usage.
    EXECUTE 'GRANT USAGE ON SCHEMA ingester, appview, public TO appview_reader';

    -- ingester: SELECT-only on everything (covers tables AND the matview).
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA ingester TO appview_reader';
    -- notifications.read is the one write the appview needs on an ingester table.
    EXECUTE 'GRANT UPDATE ON TABLE ingester.notifications TO appview_reader';

    -- appview: full CRUD (OAuth + private location).
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA appview
             TO appview_reader';

    -- public: sensitive_species read-only.
    EXECUTE 'GRANT SELECT ON TABLE public.sensitive_species TO appview_reader';

    -- Default privileges on future tables in each schema. Scoped to objects
    -- created by the postgres role (the migrator), matching today's behavior.
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ingester
             GRANT SELECT ON TABLES TO appview_reader';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA appview
             GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO appview_reader';
END
$$;
