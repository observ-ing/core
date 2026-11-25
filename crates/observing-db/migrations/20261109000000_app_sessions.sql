-- Opaque sign-in sessions for the appview.
--
-- The session cookie (or `Authorization: Bearer` header) carries a random
-- token; this table maps the SHA-256 of that token to the signed-in DID.
-- Only the hash is stored, so a read of this table can't be replayed as a
-- session. `oauth_sessions` stays as atrium's store of atproto tokens keyed
-- by DID: a row there is a PDS credential, not proof of who is calling.
--
-- Never expose this table in the admin browser.
CREATE TABLE appview.app_sessions (
    token_hash   BYTEA       PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    did          TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL
);

-- List or revoke all of a user's sessions.
CREATE INDEX app_sessions_did_idx ON appview.app_sessions (did);
