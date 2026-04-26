-- Move ownership of `ingester` and `appview` tables (and sequences) from
-- `cloudsqlsuperuser` to `postgres`, then drop the workaround USAGE grant
-- added in 20260425000000.
--
-- Background: those tables were created in `public` long before the schema
-- split (#324) and ended up owned by `cloudsqlsuperuser` (Cloud SQL's
-- implicit role for built-in users at table-create time). `ALTER TABLE …
-- SET SCHEMA` preserved that ownership when the tables were moved. Newer
-- tables created after migrations standardized on `postgres` (e.g.
-- `notification_reads`) are owned by `postgres` and don't have this issue.
--
-- Why it matters: FK constraint triggers run in the table-owner's context.
-- With `cloudsqlsuperuser` as the owner and no USAGE on the new schemas,
-- every FK check failed once #334's runbook revoked `cloudsqlsuperuser`
-- membership from the runtime users (see 20260425000000 for the full
-- post-mortem). Rather than keeping the special USAGE grant alive forever,
-- normalize ownership on `postgres` — which already has full schema access
-- as the schema owner — so the FK trigger path "just works" without the
-- grant.
--
-- Index ownership follows the table (PG enforces `idx.relowner = tbl.relowner`),
-- so `ALTER TABLE … OWNER TO` covers indexes implicitly.
--
-- Idempotent: only operates on objects currently owned by `cloudsqlsuperuser`.
-- No-op on local/CI where the role doesn't exist (the catalog query just
-- returns zero rows).
DO $$
DECLARE
    obj record;
BEGIN
    FOR obj IN
        SELECT n.nspname AS schema_name, c.relname AS rel_name, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles r     ON r.oid = c.relowner
        WHERE n.nspname IN ('ingester', 'appview')
          AND r.rolname = 'cloudsqlsuperuser'
          AND c.relkind IN ('r', 'S', 'm')  -- tables, sequences, materialized views
    LOOP
        EXECUTE format(
            'ALTER %s %I.%I OWNER TO postgres',
            CASE obj.relkind
                WHEN 'r' THEN 'TABLE'
                WHEN 'S' THEN 'SEQUENCE'
                WHEN 'm' THEN 'MATERIALIZED VIEW'
            END,
            obj.schema_name,
            obj.rel_name
        );
    END LOOP;
END
$$;

-- Drop the workaround USAGE grant from 20260425000000. With `postgres` now
-- owning everything in `ingester`/`appview`, FK triggers no longer need
-- `cloudsqlsuperuser` to be able to see those schemas. No-op on local/CI.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudsqlsuperuser') THEN
        RAISE NOTICE 'cloudsqlsuperuser role not found; skipping (expected on local/CI)';
        RETURN;
    END IF;

    EXECUTE 'REVOKE USAGE ON SCHEMA ingester, appview FROM cloudsqlsuperuser';
END
$$;
