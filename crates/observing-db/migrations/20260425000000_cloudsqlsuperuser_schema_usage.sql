-- Grant `cloudsqlsuperuser` USAGE on the `ingester` and `appview` schemas.
--
-- Tables in those schemas were created by the `postgres` migrator but ended
-- up owned by `cloudsqlsuperuser` (Cloud SQL's role membership chain). FK
-- constraint triggers (e.g. `identifications.subject_uri → occurrences.uri`)
-- run as the table owner — `cloudsqlsuperuser`. Since the new schemas were
-- only granted USAGE to the runtime roles, the trigger query
--
--     SELECT 1 FROM ONLY "ingester"."occurrences" x WHERE "uri" = $1 ...
--
-- failed with `permission denied for schema ingester` for every INSERT into
-- any table with an FK back into `ingester`. The bug was masked while
-- `cloudsqlsuperuser` membership was inherited by the runtime users; once
-- 20260424000000_create_runtime_base_role landed and the runbook revoke
-- ran in prod, every firehose write started erroring (~6 days of lost
-- identifications/comments/likes/interactions until this grant landed).
--
-- Idempotent and a no-op on local/CI where `cloudsqlsuperuser` doesn't exist.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudsqlsuperuser') THEN
        RAISE NOTICE 'cloudsqlsuperuser role not found; skipping (expected on local/CI)';
        RETURN;
    END IF;

    EXECUTE 'GRANT USAGE ON SCHEMA ingester, appview TO cloudsqlsuperuser';
END
$$;
