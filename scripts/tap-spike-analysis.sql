-- Tap spike: post-observation analysis queries.
--
-- Run after both `tap-shadow` and the patched ingester (SPIKE_LOG_EVENTS=1)
-- have run in parallel for 24-72 hours.
--
-- Reset the table before the observation window:
--   psql "$DATABASE_URL" -c 'TRUNCATE tap_spike.event_log;'

\timing on

----------------------------------------------------------------------
-- Headline numbers
----------------------------------------------------------------------

SELECT source, COUNT(*) AS rows, MIN(received_at) AS first, MAX(received_at) AS last
FROM tap_spike.event_log
GROUP BY source
ORDER BY source;

----------------------------------------------------------------------
-- 1. Coverage delta
--    For each (did, collection, rkey, cid) tuple, was it seen by tap,
--    jetstream, or both? "tap-only" is the headline win; "jetstream-only"
--    is the risk we'd take by switching.
----------------------------------------------------------------------

WITH per_record AS (
    SELECT did, collection, rkey, cid,
           bool_or(source = 'tap')        AS seen_by_tap,
           bool_or(source = 'jetstream')  AS seen_by_jetstream
    FROM tap_spike.event_log
    GROUP BY did, collection, rkey, cid
)
SELECT
    CASE
        WHEN seen_by_tap AND seen_by_jetstream THEN 'both'
        WHEN seen_by_tap                       THEN 'tap-only'
        WHEN seen_by_jetstream                 THEN 'jetstream-only'
    END AS bucket,
    COUNT(*) AS records
FROM per_record
GROUP BY 1
ORDER BY 1;

----------------------------------------------------------------------
-- 2. Repo discovery
--    DIDs Tap surfaced via collection-signal that are NOT in the
--    appview.oauth_sessions set the existing `--all` backfill is
--    bounded by. This is the headline product gap the spike tests.
----------------------------------------------------------------------

-- NOTE: appview.oauth_sessions stores the DID in the `key` column, not `did`.
SELECT DISTINCT e.did
FROM tap_spike.event_log e
LEFT JOIN appview.oauth_sessions s ON s.key = e.did
WHERE e.source = 'tap'
  AND s.key IS NULL
ORDER BY e.did;

-- ...and the inverse: DIDs in oauth_sessions that Tap did NOT surface
-- (these are users who logged in but apparently have no occurrence
-- records — Tap's signal collection wouldn't pick them up).

SELECT s.key AS did
FROM appview.oauth_sessions s
LEFT JOIN (SELECT DISTINCT did FROM tap_spike.event_log WHERE source = 'tap') t
       ON t.did = s.key
WHERE t.did IS NULL
ORDER BY s.key;

----------------------------------------------------------------------
-- 3. Latency
--    For records seen by both, how much earlier did one source land
--    than the other. (`live=true` only — backfill latency from Tap is
--    inherently larger and not comparable to firehose latency.)
----------------------------------------------------------------------

WITH first_seen AS (
    SELECT did, collection, rkey,
           MIN(received_at) FILTER (WHERE source = 'tap'       AND live IS TRUE) AS tap_at,
           MIN(received_at) FILTER (WHERE source = 'jetstream')                  AS jet_at
    FROM tap_spike.event_log
    GROUP BY did, collection, rkey
    HAVING COUNT(DISTINCT source) = 2
)
SELECT
    COUNT(*)                                                  AS overlapping_records,
    AVG(EXTRACT(EPOCH FROM (tap_at - jet_at)))                AS avg_tap_minus_jet_secs,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (tap_at - jet_at))) AS p50,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (tap_at - jet_at))) AS p95
FROM first_seen
WHERE tap_at IS NOT NULL AND jet_at IS NOT NULL;

----------------------------------------------------------------------
-- 4. Backfill behavior
--    For each repo Tap is tracking, how many backfill (live=false)
--    vs live (live=true) events did we see. Confirms backfill ran
--    and live cutover happened.
----------------------------------------------------------------------

SELECT did,
       COUNT(*) FILTER (WHERE live IS FALSE) AS backfill_events,
       COUNT(*) FILTER (WHERE live IS TRUE)  AS live_events
FROM tap_spike.event_log
WHERE source = 'tap'
GROUP BY did
ORDER BY backfill_events DESC, live_events DESC;

----------------------------------------------------------------------
-- 5. Duplicate / redelivery rate (sanity check)
--    Tap promises at-least-once. How often did a (did, collection,
--    rkey, cid) appear more than once per source?
----------------------------------------------------------------------

SELECT source, AVG(n)::numeric(10,2) AS avg_redelivery, MAX(n) AS max_redelivery
FROM (
    SELECT source, did, collection, rkey, cid, COUNT(*) AS n
    FROM tap_spike.event_log
    GROUP BY source, did, collection, rkey, cid
) per_record
GROUP BY source
ORDER BY source;
