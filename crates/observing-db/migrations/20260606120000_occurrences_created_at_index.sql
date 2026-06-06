-- Index the feed sort/keyset on `occurrences`.
--
-- Every feed (home / explore / profile / taxon) sorts by
-- `(created_at DESC, uri DESC)` and paginates with the keyset cursor
-- `(created_at, uri) < ($cursor_ts, $cursor_uri)`. The only occurrence
-- indexes were on `location`, `scientific_name`, `did`, and `event_date`, so
-- without a `created_at` index every feed page did a full sort of the whole
-- table to return ~20 rows — cost grows with the table.
--
-- This composite index matches both the ORDER BY and the keyset tuple
-- comparison, turning each page into a backwards index range scan.
--
-- Built non-concurrently: sqlx runs each migration inside a transaction, which
-- precludes CREATE INDEX CONCURRENTLY. The build takes a lock that blocks
-- writes (but not reads) on `occurrences` for its duration.
CREATE INDEX IF NOT EXISTS occurrences_created_at_uri_idx
    ON ingester.occurrences (created_at DESC, uri DESC);
