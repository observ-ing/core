-- Tap spike: shadow event log written by both the Jetstream ingester and
-- the tap-shadow consumer in parallel. See docs notes from the Tap spike.
--
-- Apply once before starting either process:
--   psql "$DATABASE_URL" -f scripts/tap-spike-schema.sql
--
-- Drop after the spike concludes:
--   psql "$DATABASE_URL" -c 'DROP SCHEMA tap_spike CASCADE;'

CREATE SCHEMA IF NOT EXISTS tap_spike;

CREATE TABLE IF NOT EXISTS tap_spike.event_log (
    id            BIGSERIAL PRIMARY KEY,
    source        TEXT        NOT NULL,                   -- 'tap' | 'jetstream'
    did           TEXT        NOT NULL,
    collection    TEXT        NOT NULL,
    rkey          TEXT        NOT NULL,
    cid           TEXT,                                   -- null for delete
    action        TEXT        NOT NULL,                   -- create | update | delete
    live          BOOLEAN,                                -- tap only; null for jetstream
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    tap_event_id  BIGINT                                  -- tap only, for debugging
);

CREATE INDEX IF NOT EXISTS event_log_source_did_idx
    ON tap_spike.event_log (source, did);

CREATE INDEX IF NOT EXISTS event_log_uri_idx
    ON tap_spike.event_log (did, collection, rkey);

CREATE INDEX IF NOT EXISTS event_log_received_at_idx
    ON tap_spike.event_log (received_at);
