-- Compound indexes for profile feed pagination queries.
-- These replace sequential scans + sorts with index scans for
-- WHERE did = $1 ORDER BY <timestamp> DESC patterns.

CREATE INDEX IF NOT EXISTS idx_occurrences_did_created_at
    ON occurrences (did, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_identifications_did_date_identified
    ON identifications (did, date_identified DESC);
