-- Add a raw Darwin Core eventDate column.
--
-- Upstream lexicons.bio loosened bio.lexicons.temp.v0-1.occurrence.eventDate
-- from a strict datetime to a free-form string that may be a single date, a
-- date-time, or an interval (e.g. "1971", "1995-05-21/1995-05-23"). We keep the
-- existing TIMESTAMPTZ `event_date` as a sortable instant — the start of the
-- interval the value denotes — and add `event_date_raw` to preserve the
-- original string verbatim for display and round-tripping. A later migration
-- will add the explicit [start, end) bounds used for interval-overlap filters.
ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS event_date_raw TEXT;

-- Backfill: existing rows only ever stored a single instant, so the best
-- available raw value is that instant rendered as an ISO 8601 UTC string.
UPDATE occurrences
SET event_date_raw = to_char(event_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
WHERE event_date_raw IS NULL AND event_date IS NOT NULL;
