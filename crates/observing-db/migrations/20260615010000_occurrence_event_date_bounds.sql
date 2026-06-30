-- Normalize eventDate to a half-open [start, end) UTC interval for filtering.
--
-- Building on event_date_raw (the verbatim string), give every occurrence an
-- explicit [start, end) interval so date filters can be expressed as interval
-- overlap rather than a comparison against a single instant — the only correct
-- way to filter a field that may hold a range or reduced precision (e.g. "1971"
-- denotes [1971-01-01, 1972-01-01)). Sorting still uses the start bound.

-- The old single-instant column becomes the interval start.
ALTER TABLE occurrences RENAME COLUMN event_date TO event_date_start;
ALTER INDEX occurrences_event_date_idx RENAME TO occurrences_event_date_start_idx;

ALTER TABLE occurrences ADD COLUMN event_date_end TIMESTAMPTZ;

-- Backfill the end bound for existing rows. Their original precision is no
-- longer recoverable, so treat each legacy instant as second-precision —
-- consistent with how the prior migration rendered event_date_raw.
UPDATE occurrences
SET event_date_end = event_date_start + INTERVAL '1 second'
WHERE event_date_end IS NULL AND event_date_start IS NOT NULL;

-- Materialized half-open range used by overlap queries. NULL (not the infinite
-- range that tstzrange(NULL, NULL) would yield) when the row is undated, so
-- date-filtered queries exclude undated occurrences instead of matching them.
ALTER TABLE occurrences
    ADD COLUMN event_date_range tstzrange GENERATED ALWAYS AS (
        CASE
            WHEN event_date_start IS NOT NULL
            THEN tstzrange(event_date_start, event_date_end, '[)')
        END
    ) STORED;

CREATE INDEX occurrences_event_date_range_idx
    ON occurrences USING GIST (event_date_range);
