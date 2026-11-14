-- One-time codes for signing a native app (or another app with its own
-- callback) in through the appview.
--
-- The app opens `/oauth/app/login` in the system browser with a PKCE
-- `code_challenge`; after the atproto OAuth flow the appview redirects to the
-- app's callback with a random code instead of setting a cookie. The app
-- trades the code and its `code_verifier` at `/oauth/app/token` for a session
-- token (`app_sessions`). Only the code's SHA-256 is stored, a code works
-- once, and it expires in minutes.
--
-- Never expose this table in the admin browser.
CREATE TABLE appview.app_login_codes (
    code_hash      BYTEA       PRIMARY KEY CHECK (octet_length(code_hash) = 32),
    did            TEXT        NOT NULL,
    code_challenge TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ NOT NULL
);
