-- Per-user appview preferences (e.g. default license for uploads).
--
-- Single row per DID. Each preference is a separate nullable column so
-- "not set" stays distinct from any specific value, and new prefs can
-- be added with cheap ALTER TABLEs.
CREATE TABLE appview.user_preferences (
    did TEXT PRIMARY KEY,
    default_license TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
