-- Remove `is_agreement` from identifications and the community_ids matview.
-- The lexicon no longer carries `isAgreement` on identification records;
-- consensus is derived purely from each user's most recent taxon pick.

DROP MATERIALIZED VIEW IF EXISTS community_ids;

ALTER TABLE identifications DROP COLUMN IF EXISTS is_agreement;

CREATE MATERIALIZED VIEW IF NOT EXISTS community_ids AS
WITH latest_ids AS (
    SELECT DISTINCT ON (did, subject_uri)
        subject_uri, scientific_name, kingdom
    FROM identifications
    ORDER BY did, subject_uri, date_identified DESC
)
SELECT
    o.uri as occurrence_uri,
    li.scientific_name,
    li.kingdom,
    COUNT(*) as id_count
FROM occurrences o
JOIN latest_ids li ON li.subject_uri = o.uri
GROUP BY o.uri, li.scientific_name, li.kingdom
ORDER BY o.uri, id_count DESC;

CREATE UNIQUE INDEX IF NOT EXISTS community_ids_uri_taxon_idx
    ON community_ids(occurrence_uri, scientific_name, kingdom);
