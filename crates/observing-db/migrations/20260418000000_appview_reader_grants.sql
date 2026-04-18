-- Privilege split for the appview_reader role.
--
-- The ingester is the single writer for occurrence-derived tables; the appview
-- owns OAuth + private-location data and UPDATEs notifications.read. This
-- migration makes that invariant enforceable at the DB layer.
--
-- The role is created out-of-band via Cloud SQL user management before the
-- migration lands in prod. On fresh local/CI DBs where the role does not
-- exist, this migration is a no-op.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appview_reader') THEN
        RAISE NOTICE 'appview_reader role not found; skipping grants (expected on local/CI)';
        RETURN;
    END IF;

    -- Clean slate: any previous manual grants are superseded by this migration.
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM appview_reader';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM appview_reader';

    -- Schema access.
    EXECUTE 'GRANT USAGE ON SCHEMA public TO appview_reader';

    -- Ingester-owned tables: SELECT only.
    EXECUTE 'GRANT SELECT ON TABLE
        occurrences,
        occurrence_observers,
        identifications,
        comments,
        interactions,
        likes
        TO appview_reader';

    -- notifications: ingester INSERTs from firehose events, appview UPDATEs
    -- the read flag via mark_read / mark_all_read.
    EXECUTE 'GRANT SELECT, UPDATE ON TABLE notifications TO appview_reader';

    -- Appview-owned tables: full CRUD.
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
        occurrence_private_data,
        oauth_sessions,
        oauth_state
        TO appview_reader';

    -- Read access to diagnostic / reference tables.
    EXECUTE 'GRANT SELECT ON TABLE
        sensitive_species,
        ingester_state
        TO appview_reader';

    -- Future tables created by the (postgres) migrator default to SELECT-only
    -- for the appview; tables that need appview writes get explicit GRANTs
    -- alongside their CREATE TABLE migration.
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public
             GRANT SELECT ON TABLES TO appview_reader';
END
$$;
