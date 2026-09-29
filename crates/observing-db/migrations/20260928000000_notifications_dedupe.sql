-- One notification per (recipient, actor, kind, referenced record).
--
-- The ingester notifies an occurrence's owner when an identification, comment,
-- or like lands. Tap delivers at-least-once (redelivery after a missed ack,
-- replay after a cursor rewind), and editing a record delivers it again;
-- nothing deduplicated those, so each one notified the owner again. Found by
-- the tap-ingester sim (notifications_at_most_once).
--
-- Merge existing duplicates into the earliest row, carrying any read marker
-- over so a notification already read doesn't reappear as unread, then enforce
-- uniqueness. `notifications::create` inserts with ON CONFLICT DO NOTHING.
-- Rows with a NULL reference_uri (legacy; the ingester always sets it) stay
-- distinct under the index, as before.

CREATE TEMPORARY TABLE notification_dupes ON COMMIT DROP AS
SELECT id, keep_id
FROM (
    SELECT id,
           MIN(id) OVER (PARTITION BY recipient_did, actor_did, kind, reference_uri) AS keep_id
    FROM ingester.notifications
    WHERE reference_uri IS NOT NULL
) ranked
WHERE id <> keep_id;

INSERT INTO appview.notification_reads (notification_id, read_at)
SELECT d.keep_id, MIN(r.read_at)
FROM notification_dupes d
JOIN appview.notification_reads r ON r.notification_id = d.id
GROUP BY d.keep_id
ON CONFLICT DO NOTHING;

DELETE FROM appview.notification_reads
WHERE notification_id IN (SELECT id FROM notification_dupes);

DELETE FROM ingester.notifications
WHERE id IN (SELECT id FROM notification_dupes);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_once_per_reference_idx
    ON ingester.notifications (recipient_did, actor_did, kind, reference_uri);
