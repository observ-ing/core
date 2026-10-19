-- Indexes for read paths that were scanning far more rows than they return.
--
-- Built non-concurrently for the same reason as
-- 20260606120000_occurrences_created_at_index.sql: sqlx runs each migration
-- inside a transaction. Each build blocks writes (not reads) on its table for
-- its duration.

-- Taxon pages and `?kingdom=` filters resolve through
-- `community_ids JOIN taxa ... WHERE t.<rank> = $name`
-- (`observing_db::feeds::push_consensus_rank_filter`). Every rank column had
-- an index except `species` — the rank of most taxon pages — and the fallback
-- `scientific_name`, whose only index is on LOWER(scientific_name). Both
-- seq-scanned the whole taxa cache.
CREATE INDEX IF NOT EXISTS taxa_species_idx ON ingester.taxa (species);
CREATE INDEX IF NOT EXISTS taxa_scientific_name_idx ON ingester.taxa (scientific_name);

-- The notifications list orders by `id DESC` and pages on `id < $cursor`, but
-- the recipient index was keyed on `created_at`, so the planner walked the
-- primary key backwards and filtered on recipient — the whole table, for a
-- recipient with fewer notifications than one page. Nothing orders
-- notifications by `created_at`, so this replaces that index; its leading
-- `recipient_did` still serves the unread count and mark-all-read.
CREATE INDEX IF NOT EXISTS notifications_recipient_id_idx
    ON ingester.notifications (recipient_did, id DESC);
DROP INDEX IF EXISTS ingester.idx_notifications_recipient;

-- Profile feeds filter on `did` and sort by `created_at DESC, uri DESC`
-- (occurrences) or `date_identified DESC` (identifications). With only a
-- `did` index, each page fetched and sorted every one of the user's rows.
-- These composites return a page straight off the index, and their leading
-- `did` column serves every lookup the single-column indexes did.
CREATE INDEX IF NOT EXISTS occurrences_did_created_at_uri_idx
    ON ingester.occurrences (did, created_at DESC, uri DESC);
DROP INDEX IF EXISTS ingester.occurrences_did_idx;

CREATE INDEX IF NOT EXISTS identifications_did_date_identified_idx
    ON ingester.identifications (did, date_identified DESC);
DROP INDEX IF EXISTS ingester.identifications_did_idx;
