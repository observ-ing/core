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
-- Subtle: this migration runs as `postgres`, but #334 revoked
-- `cloudsqlsuperuser` membership from the runtime roles (the path postgres
-- relied on to operate on objects owned by them). After that point,
-- postgres can no longer GRANT on or ALTER OWNER of objects owned by a
-- runtime role. The only such object today is `ingester.community_ids`
-- (owned by `ingester_runtime` since 20260421), so the `ingester` schema
-- grants enumerate over postgres-owned tables instead of using the
-- schema-wide ON ALL TABLES form, and ALTER OWNER is guarded on current
-- ownership. On a from-scratch migrate, community_ids is still owned by
-- postgres at this point, the enumeration includes it, and the ALTER
-- OWNER transfers it; on existing prod the enumeration skips it and the
-- ALTER OWNER is a no-op.
--
-- Idempotent. No-op on local/CI where the runtime roles don't exist.

DO $$
DECLARE
    tbl text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appview_runtime') THEN
        RAISE NOTICE 'appview_runtime role not found; skipping grants (expected on local/CI)';
        RETURN;
    END IF;

    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM appview_runtime';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA appview FROM appview_runtime';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM appview_runtime';
    -- ingester schema: REVOKE iterates per-table and errors on objects
    -- postgres can't operate on (community_ids), so enumerate over
    -- postgres-owned tables/matviews only.
    FOR tbl IN
        SELECT format('%I.%I', n.nspname, c.relname)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ingester'
          AND c.relkind IN ('r', 'p', 'm')
          AND pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
    LOOP
        EXECUTE format('REVOKE ALL ON TABLE %s FROM appview_runtime', tbl);
    END LOOP;

    EXECUTE 'GRANT USAGE ON SCHEMA ingester, appview, public TO appview_runtime';

    -- ingester: SELECT-only, plus UPDATE on notifications.read. Enumerated
    -- over postgres-owned tables/matviews; appview_runtime's SELECT on
    -- ingester.community_ids was already granted by ingester_runtime in a
    -- prior run.
    FOR tbl IN
        SELECT format('%I.%I', n.nspname, c.relname)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ingester'
          AND c.relkind IN ('r', 'p', 'm')
          AND pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
    LOOP
        EXECUTE format('GRANT SELECT ON TABLE %s TO appview_runtime', tbl);
    END LOOP;
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
DECLARE
    tbl text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingester_runtime') THEN
        RAISE NOTICE 'ingester_runtime role not found; skipping grants (expected on local/CI)';
        RETURN;
    END IF;

    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA appview FROM ingester_runtime';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ingester_runtime';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA ingester FROM ingester_runtime';
    -- ingester schema: enumerate, same reason as in the appview_runtime block.
    FOR tbl IN
        SELECT format('%I.%I', n.nspname, c.relname)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ingester'
          AND c.relkind IN ('r', 'p', 'm')
          AND pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
    LOOP
        EXECUTE format('REVOKE ALL ON TABLE %s FROM ingester_runtime', tbl);
    END LOOP;

    EXECUTE 'GRANT USAGE ON SCHEMA ingester, appview, public TO ingester_runtime';

    -- ingester: full CRUD. Enumerated over postgres-owned tables/matviews;
    -- ingester_runtime is the owner of community_ids in existing prod and
    -- already has full privileges implicitly there.
    FOR tbl IN
        SELECT format('%I.%I', n.nspname, c.relname)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ingester'
          AND c.relkind IN ('r', 'p', 'm')
          AND pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
    LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO ingester_runtime', tbl);
    END LOOP;
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ingester
             TO ingester_runtime';

    -- appview: backfill --all reads oauth_sessions to discover known DIDs.
    EXECUTE 'GRANT SELECT ON TABLE appview.oauth_sessions TO ingester_runtime';

    -- public: sensitive_species reference data.
    EXECUTE 'GRANT SELECT ON TABLE public.sensitive_species TO ingester_runtime';

    -- REFRESH MATERIALIZED VIEW CONCURRENTLY requires ownership. Guarded on
    -- current ownership: ALTER OWNER TO requires the runner to be a member
    -- of the target role, and #334 revoked the path postgres relied on.
    -- 20260421 originally transferred ownership when postgres still had it,
    -- and 20260423 preserved it through the rename, so this is a no-op on
    -- every environment that reached the predecessor; on a from-scratch
    -- migrate the matview is still postgres-owned here and gets transferred.
    IF pg_catalog.pg_get_userbyid(
        (SELECT relowner FROM pg_class WHERE oid = 'ingester.community_ids'::regclass)
    ) <> 'ingester_runtime' THEN
        EXECUTE 'ALTER MATERIALIZED VIEW ingester.community_ids OWNER TO ingester_runtime';
    END IF;

    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ingester
             GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ingester_runtime';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ingester
             GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ingester_runtime';
END
$$;
