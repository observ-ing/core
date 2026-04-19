-- Give the ingester runtime its own least-privilege DB role.
--
-- Before this, the ingester connected as `postgres` (superuser). After the
-- schema split and the notification_reads split, the ingester actually only
-- needs:
--   - CRUD on the `ingester` schema
--   - SELECT on `appview.oauth_sessions` (for the backfill --all binary)
--   - SELECT on `public.sensitive_species`
--
-- So we mirror the pattern we set up for `appview_reader`: define the runtime
-- grants here (idempotent no-op when the role is absent, as on CI/local),
-- create the role separately in Cloud SQL, and flip the Cloud Run env in a
-- follow-up PR.
--
-- Migrations themselves still run as `postgres` — the ingester process will
-- connect twice on startup: once with `DATABASE_ADMIN_URL` to migrate, then
-- with `DATABASE_URL` (ingester_writer) for runtime writes.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingester_writer') THEN
        RAISE NOTICE 'ingester_writer role not found; skipping grants (expected on local/CI)';
        RETURN;
    END IF;

    -- Clean slate. No prior grants to this role on any schema, but guard
    -- against reruns / partial state.
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ingester FROM ingester_writer';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA appview FROM ingester_writer';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ingester_writer';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA ingester FROM ingester_writer';

    -- Schema usage.
    EXECUTE 'GRANT USAGE ON SCHEMA ingester, appview, public TO ingester_writer';

    -- ingester: full CRUD on all current and future tables.
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ingester
             TO ingester_writer';
    -- BIGSERIAL columns need sequence access for nextval().
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ingester
             TO ingester_writer';

    -- appview: the backfill --all binary reads oauth_sessions to discover
    -- known DIDs. Nothing else in the ingester touches the appview schema.
    EXECUTE 'GRANT SELECT ON TABLE appview.oauth_sessions TO ingester_writer';

    -- public: sensitive_species reference data, read-only.
    EXECUTE 'GRANT SELECT ON TABLE public.sensitive_species TO ingester_writer';

    -- REFRESH MATERIALIZED VIEW CONCURRENTLY requires ownership (or MAINTAIN
    -- privilege, added in PG17). Transfer ownership so the runtime role can
    -- refresh community_ids after each identification upsert/delete.
    EXECUTE 'ALTER MATERIALIZED VIEW ingester.community_ids OWNER TO ingester_writer';

    -- Default privileges so future tables/sequences created by the postgres
    -- migrator are immediately usable by the runtime role.
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ingester
             GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ingester_writer';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ingester
             GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ingester_writer';
END
$$;
