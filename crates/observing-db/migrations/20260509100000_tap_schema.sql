-- Tap's persistent state (tracked DIDs, cursors, retry queues) lives in
-- its own `tap` schema, separate from observ.ing's app tables. This
-- replaces the per-instance ephemeral SQLite at /data/tap.db, where
-- every Cloud Run revision lost Tap's tracked-DID list and forced a
-- full repo backfill on each deploy.
--
-- tap-ingester connects with `?options=-c search_path=tap`, so Tap's
-- unqualified CREATE TABLE statements land here. The schema is
-- owned by postgres but ingester_runtime has CREATE on it, so the
-- tables Tap creates end up owned by ingester_runtime with full
-- privileges (postgres can no longer GRANT on or operate on objects
-- owned by ingester_runtime — see the comment in 20260428000001 —
-- which is fine since Tap is the only thing reading or writing here).
--
-- Idempotent. The grants block no-ops where `ingester_runtime`
-- doesn't exist (local/CI).

CREATE SCHEMA IF NOT EXISTS tap;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingester_runtime') THEN
        RAISE NOTICE 'ingester_runtime role not found; skipping tap-schema grants (expected on local/CI)';
        RETURN;
    END IF;
    EXECUTE 'GRANT USAGE, CREATE ON SCHEMA tap TO ingester_runtime';
END
$$;
