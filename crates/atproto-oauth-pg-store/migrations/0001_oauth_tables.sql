-- Tables required by atproto-oauth-pg-store.
--
-- `oauth_state` holds short-lived PKCE/CSRF flow data, expired by a TTL.
-- `oauth_sessions` holds logged-in user sessions, keyed by DID.

CREATE TABLE IF NOT EXISTS oauth_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_state_expires_idx ON oauth_state(expires_at);

CREATE TABLE IF NOT EXISTS oauth_sessions (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
