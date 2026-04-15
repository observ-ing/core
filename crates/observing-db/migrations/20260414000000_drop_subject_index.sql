-- Drop the subjectIndex feature (multi-subject observations).
-- Tracked for possible reintroduction in GitHub issue #276.

DROP MATERIALIZED VIEW IF EXISTS community_ids;

DROP INDEX IF EXISTS identifications_subject_idx;
ALTER TABLE identifications DROP COLUMN IF EXISTS subject_index;

ALTER TABLE interactions DROP COLUMN IF EXISTS subject_a_subject_index;
ALTER TABLE interactions DROP COLUMN IF EXISTS subject_b_subject_index;

CREATE MATERIALIZED VIEW IF NOT EXISTS community_ids AS
WITH latest_ids AS (
    SELECT DISTINCT ON (did, subject_uri)
        subject_uri, scientific_name, kingdom, is_agreement
    FROM identifications
    ORDER BY did, subject_uri, date_identified DESC
)
SELECT
    o.uri as occurrence_uri,
    li.scientific_name,
    li.kingdom,
    COUNT(*) as id_count,
    COUNT(*) FILTER (WHERE li.is_agreement) as agreement_count
FROM occurrences o
JOIN latest_ids li ON li.subject_uri = o.uri
GROUP BY o.uri, li.scientific_name, li.kingdom
ORDER BY o.uri, id_count DESC;

CREATE UNIQUE INDEX IF NOT EXISTS community_ids_uri_taxon_idx
    ON community_ids(occurrence_uri, scientific_name, kingdom);
