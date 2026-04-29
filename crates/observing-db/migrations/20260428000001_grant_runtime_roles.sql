-- Re-issue runtime grants against the post-rename role names.
--
-- Earlier migrations granted to the pre-rename roles `appview_reader`
-- (20260418, 20260419) and `ingester_writer` (20260421). The rename
-- migrations (20260422, 20260423) preserved those grants on databases that
-- already had them — but on a from-scratch migrate (e.g. after a wipe),
-- every grant migration silently no-ops because the pre-rename roles no
-- longer exist (role memberships at the Cloud SQL instance level survive
-- DROP DATABASE), and the rename migrations also no-op because the
-- post-rename roles already exist. Net effect: runtime roles end up with
-- zero privileges and the services crashloop.
--
-- This migration is the canonical source of truth for runtime grants
-- against the current role names. Older grant migrations are kept for
-- history; their effect is now subsumed here for any DB where the renames
-- have already happened.
--
-- Idempotent (REVOKE-then-GRANT, OWNER TO is unconditional). No-op on
-- local/CI where the runtime roles don't exist.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appview_runtime') THEN
        RAISE NOTICE 'appview_runtime role not found; skipping grants (expected on local/CI)';
        RETURN;
    END IF;

    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM appview_runtime';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ingester FROM appview_runtime';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA appview FROM appview_runtime';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM appview_runtime';

    EXECUTE 'GRANT USAGE ON SCHEMA ingester, appview, public TO appview_runtime';

    -- ingester: SELECT-only, plus UPDATE on notifications.read.
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA ingester TO appview_runtime';
    EXECUTE 'GRANT UPDATE ON TABLE ingester.notifications TO appview_runtime';

    -- appview: full CRUD (OAuth + private location + notification_reads).
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA appview
             TO appview_runtime';

    -- public: sensitive_species reference data.
    EXECUTE 'GRANT SELECT ON TABLE public.sensitive_species TO appview_runtime';

    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ingester
             GRANT SELECT ON TABLES TO appview_runtime';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA appview
             GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO appview_runtime';
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingester_runtime') THEN
        RAISE NOTICE 'ingester_runtime role not found; skipping grants (expected on local/CI)';
        RETURN;
    END IF;

    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ingester FROM ingester_runtime';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA appview FROM ingester_runtime';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ingester_runtime';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA ingester FROM ingester_runtime';

    EXECUTE 'GRANT USAGE ON SCHEMA ingester, appview, public TO ingester_runtime';

    -- ingester: full CRUD on tables, plus sequence access for BIGSERIAL nextval().
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ingester
             TO ingester_runtime';
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ingester
             TO ingester_runtime';

    -- appview: backfill --all reads oauth_sessions to discover known DIDs.
    EXECUTE 'GRANT SELECT ON TABLE appview.oauth_sessions TO ingester_runtime';

    -- public: sensitive_species reference data.
    EXECUTE 'GRANT SELECT ON TABLE public.sensitive_species TO ingester_runtime';

    -- REFRESH MATERIALIZED VIEW CONCURRENTLY requires ownership.
    EXECUTE 'ALTER MATERIALIZED VIEW ingester.community_ids OWNER TO ingester_runtime';

    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ingester
             GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ingester_runtime';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ingester
             GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ingester_runtime';
END
$$;
