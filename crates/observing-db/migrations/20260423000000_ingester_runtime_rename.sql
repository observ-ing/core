-- Rename `ingester_writer` to `ingester_runtime`.
--
-- Matches the naming convention already used for `appview_runtime`. The role
-- isn't strictly a "writer" either — it also needs SELECT on
-- `appview.oauth_sessions` (backfill --all) and `public.sensitive_species` —
-- so "runtime" describes it more honestly.
--
-- `ALTER ROLE ... RENAME TO ...` preserves the password, all grants, and
-- ownership (including the `ingester.community_ids` matview), so no grant
-- migrations need to be re-run.
--
-- Idempotent: no-op if the role was already renamed, and no-op on local/CI
-- where the role doesn't exist.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingester_runtime') THEN
        RAISE NOTICE 'ingester_runtime role already exists; skipping rename';
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingester_writer') THEN
        RAISE NOTICE 'ingester_writer role not found; skipping rename (expected on local/CI)';
        RETURN;
    END IF;

    EXECUTE 'ALTER ROLE ingester_writer RENAME TO ingester_runtime';
END
$$;
