-- Store every like record, not one per (subject, liker).
--
-- UNIQUE (subject_uri, did) made the ingester drop a second like record for
-- the same occurrence (`ON CONFLICT (subject_uri, did) DO NOTHING`). A user
-- can end up with two — the appview doesn't check before creating one, so a
-- double tap or two tabs does it — and then unliking deleted the one row the
-- DB had while the other record stayed on the PDS: the DB said "not liked"
-- while the repo still liked it. Found by the tap-ingester sim
-- (likes_match_repos).
--
-- Now every record gets its own row (keyed by uri, as before), like counts
-- use COUNT(DISTINCT did), and unlike deletes all of the user's like records
-- for the occurrence. The replacement index keeps the (subject_uri, did)
-- lookups the unique constraint used to serve.

ALTER TABLE ingester.likes DROP CONSTRAINT IF EXISTS likes_subject_uri_did_key;

CREATE INDEX IF NOT EXISTS likes_subject_uri_did_idx
    ON ingester.likes (subject_uri, did);
