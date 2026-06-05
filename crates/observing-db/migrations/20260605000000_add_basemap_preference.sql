-- Add a per-user basemap preference ("outdoor" | "topo" | "streets" |
-- "satellite") so a user's chosen map basemap follows them across devices.
-- Nullable: NULL means "use the client default". The CHECK mirrors the client's
-- BasemapId union (and the app-level validate_basemap) as a DB-level backstop,
-- matching how geoprivacy/role are constrained in the initial migration.
ALTER TABLE appview.user_preferences
    ADD COLUMN basemap TEXT
        CHECK (basemap IN ('outdoor', 'topo', 'streets', 'satellite'));
