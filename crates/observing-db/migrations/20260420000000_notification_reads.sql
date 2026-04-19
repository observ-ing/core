-- Move notification read-state out of the ingester schema.
--
-- Before this migration, `ingester.notifications.read` was a boolean column
-- on an ingester-owned table, and the appview had a cross-schema
-- `GRANT UPDATE ON ingester.notifications TO appview_reader` so it could
-- flip the flag when a user opened a notification. That was the one write
-- the appview made into the ingester schema.
--
-- Read state is per-user UI state, not firehose-derived data, so it belongs
-- to the appview. We move it to `appview.notification_reads` (one row per
-- read notification), drop the `read` column from `ingester.notifications`,
-- and revoke the UPDATE grant. From now on the ingester owns "what the
-- firehose produced" and the appview owns "what the user did with it" —
-- cleanly split along schema lines, enforced by grants.

CREATE TABLE IF NOT EXISTS appview.notification_reads (
  notification_id BIGINT PRIMARY KEY,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill from the existing read flag so no user sees previously-read
-- notifications jump back to unread.
INSERT INTO appview.notification_reads (notification_id, read_at)
SELECT id, created_at
FROM ingester.notifications
WHERE read = TRUE
ON CONFLICT DO NOTHING;

-- Partial index dropped automatically with the column.
ALTER TABLE ingester.notifications DROP COLUMN read;

-- Drop the one appview write-grant on the ingester schema.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appview_reader') THEN
        EXECUTE 'REVOKE UPDATE ON TABLE ingester.notifications FROM appview_reader';
    END IF;
END
$$;
