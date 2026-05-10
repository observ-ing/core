-- Ledger of records that the ingester couldn't persist on the first try.
--
-- Populated from tap-ingester's main loop when `process_record` returns
-- Err and the cross-repo resolver did NOT trigger a new `/repos/add`
-- (i.e. we've decided to ack and drop). Without this ledger those
-- failures are visible only as a stats counter and a tracing line; the
-- actual records are gone the moment the WS event is acked. The table
-- captures enough state to either replay the upsert later (record_json
-- preserves the original payload) or just observe the drop pattern.
--
-- Lives in `ingester` schema alongside the other ingester-owned tables;
-- ALTER DEFAULT PRIVILEGES from 20260428000001 grants ingester_runtime
-- full CRUD and appview_runtime SELECT automatically.
--
-- Idempotent (CREATE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS ingester.failed_records (
    uri               TEXT        PRIMARY KEY,
    collection        TEXT        NOT NULL,
    did               TEXT        NOT NULL,
    cid               TEXT,
    action            TEXT        NOT NULL,
    record_json       JSONB,
    last_error        TEXT        NOT NULL,
    attempts          INTEGER     NOT NULL DEFAULT 1,
    first_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS failed_records_collection_idx
    ON ingester.failed_records (collection);

CREATE INDEX IF NOT EXISTS failed_records_last_attempt_idx
    ON ingester.failed_records (last_attempt_at DESC);
