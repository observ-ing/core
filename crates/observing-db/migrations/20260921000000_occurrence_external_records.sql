-- Surface the occurrence lexicon's `externalRecords` (#836): references to the
-- same occurrence held in another AT Protocol lexicon or on an off-network
-- service (iNaturalist, BugGuide, ...). Stored as JSONB mirroring the record
-- shape (`[{"uri": "...", "service": "inaturalist"}]`) rather than a side
-- table: the array is capped at 10 entries by the lexicon, is only ever read
-- back whole for display, and nothing joins or filters on it.
--
-- NULL for every row ingested before this column existed — the values live
-- only on the authors' PDSes. `task-runner backfill-occurrences --all`
-- re-fetches and re-parses those records to fill it in.
ALTER TABLE occurrences
    ADD COLUMN IF NOT EXISTS external_records JSONB;
