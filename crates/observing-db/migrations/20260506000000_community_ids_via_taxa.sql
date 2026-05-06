-- Rebuild `community_ids` to expose the consensus identification's
-- `accepted_taxon_key`, and reduce it to one row per occurrence (the winner).
--
-- Why: filters like `/explore?kingdom=Plantae` and `/taxon/Plantae/...`
-- need to match against the *consensus* taxon's full Linnaean ancestry,
-- not whatever the submitter typed into their occurrence record. Joining
-- `community_ids` → `taxa` on `accepted_taxon_key` gives us the canonical
-- ranks (kingdom, phylum, …, species) and disambiguates synonyms.
--
-- Shape change: previously one row per (occurrence, taxon-vote-group).
-- Now one row per occurrence — the highest-vote group wins, ties broken
-- by `subject_uri` for determinism. Existing consumers that already used
-- `DISTINCT ON (occurrence_uri) … ORDER BY id_count DESC` keep working;
-- the new shape just makes that ordering implicit.
--
-- Deployment order: requires `accepted_taxon_key` to be populated on
-- existing identifications first (run `cargo run --bin resolve_taxa`
-- before applying this), or kingdom/rank filters return empty during the
-- gap.

DROP MATERIALIZED VIEW IF EXISTS ingester.community_ids;

CREATE MATERIALIZED VIEW ingester.community_ids AS
WITH latest_ids AS (
    SELECT DISTINCT ON (did, subject_uri)
        subject_uri, scientific_name, kingdom, accepted_taxon_key
    FROM ingester.identifications
    ORDER BY did, subject_uri, date_identified DESC
),
votes AS (
    SELECT
        subject_uri,
        scientific_name,
        kingdom,
        accepted_taxon_key,
        COUNT(*) AS id_count
    FROM latest_ids
    GROUP BY subject_uri, scientific_name, kingdom, accepted_taxon_key
)
SELECT DISTINCT ON (o.uri)
    o.uri AS occurrence_uri,
    v.scientific_name,
    v.kingdom,
    v.accepted_taxon_key,
    v.id_count
FROM ingester.occurrences o
JOIN votes v ON v.subject_uri = o.uri
ORDER BY o.uri, v.id_count DESC, v.scientific_name;

CREATE UNIQUE INDEX community_ids_occurrence_uri_idx
    ON ingester.community_ids (occurrence_uri);

-- Speeds the JOIN to `taxa` for filter queries (kingdom=Plantae etc.).
CREATE INDEX community_ids_accepted_taxon_key_idx
    ON ingester.community_ids (accepted_taxon_key)
    WHERE accepted_taxon_key IS NOT NULL;

-- The runtime role refreshes this view; CREATE leaves it owned by whoever
-- ran the migration, which on prod is not `ingester_runtime`. Mirror the
-- guard from 20260428000001_grant_runtime_roles.sql so REFRESH continues
-- to work without manual intervention.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingester_runtime') THEN
        EXECUTE 'ALTER MATERIALIZED VIEW ingester.community_ids OWNER TO ingester_runtime';
    END IF;
END $$;
