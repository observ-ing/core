-- Create an empty placeholder role so CI can call `gcloud sql users
-- assign-roles --revoke-existing-roles --database-roles=runtime_base`
-- on both runtime users.
--
-- Why: Cloud SQL auto-grants `cloudsqlsuperuser` to every built-in user.
-- That membership confers `arwdDxt` on every table via role inheritance,
-- which nullifies the per-schema least-privilege grants in the
-- `appview_reader_grants` migration (appview_runtime can write ingester
-- tables; ingester_runtime can write appview tables). Verified against
-- prod with `has_table_privilege`.
--
-- The documented way to drop `cloudsqlsuperuser` from a built-in user is
-- `gcloud sql users assign-roles --revoke-existing-roles`, which requires
-- `--database-roles=` with at least one value. `runtime_base` is that
-- placeholder — it carries no privileges of its own. The direct GRANTs
-- on each user stay intact through the swap.
--
-- Idempotent: no-op if the role already exists.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'runtime_base') THEN
        RAISE NOTICE 'runtime_base role already exists; skipping';
        RETURN;
    END IF;

    EXECUTE 'CREATE ROLE runtime_base';
END
$$;
