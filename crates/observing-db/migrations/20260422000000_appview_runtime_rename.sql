-- Rename `appview_reader` to `appview_runtime`.
--
-- The name `appview_reader` predates the notification_reads split (#326),
-- which added appview writes to `appview.notification_reads`. The role is
-- no longer read-only on the appview schema — it's the appview's general
-- runtime role — so rename it to match the pattern used by `ingester_writer`.
--
-- `ALTER ROLE ... RENAME TO ...` preserves the password, all grants, and
-- ownership — so no grant migrations need to be re-run.
--
-- Idempotent: no-op if the role was already renamed, and no-op on local/CI
-- where the role doesn't exist.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appview_runtime') THEN
        RAISE NOTICE 'appview_runtime role already exists; skipping rename';
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appview_reader') THEN
        RAISE NOTICE 'appview_reader role not found; skipping rename (expected on local/CI)';
        RETURN;
    END IF;

    EXECUTE 'ALTER ROLE appview_reader RENAME TO appview_runtime';
END
$$;
