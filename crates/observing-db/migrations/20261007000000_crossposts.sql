-- Cross-posting occurrences to other platforms (#878). iNaturalist is the
-- first; `service` uses the lexicon's `externalRecords.service` values so a
-- second destination needs no new tables.

-- An account on another platform that a user has linked, and the credential
-- for acting as them there. Never expose this table in the admin browser.
CREATE TABLE appview.linked_accounts (
    did              TEXT        NOT NULL,
    service          TEXT        NOT NULL,
    external_user_id TEXT        NOT NULL,
    external_login   TEXT        NOT NULL,
    access_token     TEXT        NOT NULL,
    linked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (did, service)
);

-- The job queue. The public record of a cross-post is the occurrence's
-- externalRecords entry; external_uri here only marks which entry is ours.
CREATE TABLE appview.crossposts (
    occurrence_uri   TEXT        NOT NULL,
    service          TEXT        NOT NULL,
    did              TEXT        NOT NULL,
    external_uri     TEXT,
    synced_blob_cids TEXT[]      NOT NULL DEFAULT '{}',
    status           TEXT        NOT NULL CHECK (status IN ('pending', 'synced', 'failed')),
    attempts         INTEGER     NOT NULL DEFAULT 0,
    last_error       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (occurrence_uri, service)
);

CREATE INDEX crossposts_pending_idx
    ON appview.crossposts (service, updated_at)
    WHERE status = 'pending';
