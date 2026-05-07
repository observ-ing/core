-- Create the `taxa` cache table and add `accepted_taxon_key` to identifications.
--
-- `taxa` is a write-through cache in front of the GBIF backbone taxonomy.
-- The resolver (added in a follow-up branch) populates rows on first lookup
-- of a scientific name encountered during identification ingest, and serves
-- subsequent reads locally. Bulk-importing the entire backbone (~9M rows)
-- is explicitly avoided — storage cost and refresh complexity outweigh the
-- benefit when a project's actual usage covers a tiny slice of the tree.
--
-- Synonyms fold to their accepted taxon via `accepted_taxon_key`. Linnaean
-- ancestry is denormalized into rank columns so taxon-page and explore-feed
-- filters (`kingdom = 'Plantae'`, `family = 'Fagaceae'`, …) reduce to a
-- single equality predicate.
--
-- This migration adds schema only. The `accepted_taxon_key` column on
-- `identifications` is NULL until the resolver lands and backfills existing
-- rows; downstream consumers (community_ids matview, query layer) keep
-- using the existing denormalized columns until that point.

CREATE TABLE IF NOT EXISTS ingester.taxa (
    -- GBIF usageKey. Stable across backbone releases for a given taxon.
    taxon_key BIGINT PRIMARY KEY,

    scientific_name TEXT NOT NULL,
    authorship TEXT,
    rank TEXT NOT NULL,

    -- ACCEPTED | SYNONYM | DOUBTFUL | MISAPPLIED | NOT_FOUND.
    -- NOT_FOUND is a tombstone for names GBIF rejected, so the resolver
    -- doesn't keep retrying a typo on every identification.
    status TEXT NOT NULL,

    -- For SYNONYM/MISAPPLIED rows, the accepted taxon's key. For ACCEPTED
    -- rows, equal to taxon_key. NULL for tombstones. No FK constraint —
    -- the accepted row may not yet be cached.
    accepted_taxon_key BIGINT,

    -- Direct parent for tree walks. NULL at the kingdom level and on
    -- tombstones. No FK — same reason as accepted_taxon_key.
    parent_key BIGINT,

    -- Denormalized Linnaean ancestry. Names + GBIF keys side-by-side so
    -- joins can use whichever the calling query has on hand. NULL when a
    -- rank is absent from the taxon's classification (e.g. genus is NULL
    -- on a family-rank row).
    kingdom TEXT, kingdom_key BIGINT,
    phylum  TEXT, phylum_key  BIGINT,
    class   TEXT, class_key   BIGINT,
    "order" TEXT, order_key   BIGINT,
    family  TEXT, family_key  BIGINT,
    genus   TEXT, genus_key   BIGINT,
    species TEXT, species_key BIGINT,

    vernacular_name TEXT,
    extinct BOOLEAN,

    -- Cache bookkeeping. fetched_at drives staleness re-fetch in the
    -- resolver. source allows future non-GBIF taxonomy sources without a
    -- schema change.
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT NOT NULL DEFAULT 'gbif'
);

-- Resolver lookup: case-insensitive name match, optionally scoped by a
-- kingdom hint to disambiguate cross-kingdom homonyms.
CREATE INDEX IF NOT EXISTS taxa_lower_name_idx
    ON ingester.taxa (LOWER(scientific_name));
CREATE INDEX IF NOT EXISTS taxa_lower_name_kingdom_idx
    ON ingester.taxa (LOWER(scientific_name), kingdom);

-- Tree expansion (parent → children).
CREATE INDEX IF NOT EXISTS taxa_parent_key_idx
    ON ingester.taxa (parent_key);

-- Synonym → accepted lookup (rare; cheap to maintain).
CREATE INDEX IF NOT EXISTS taxa_accepted_taxon_key_idx
    ON ingester.taxa (accepted_taxon_key);

-- Per-rank filter queries from the taxon page and explore feed.
CREATE INDEX IF NOT EXISTS taxa_kingdom_idx ON ingester.taxa (kingdom);
CREATE INDEX IF NOT EXISTS taxa_phylum_idx  ON ingester.taxa (phylum);
CREATE INDEX IF NOT EXISTS taxa_class_idx   ON ingester.taxa (class);
CREATE INDEX IF NOT EXISTS taxa_order_idx   ON ingester.taxa ("order");
CREATE INDEX IF NOT EXISTS taxa_family_idx  ON ingester.taxa (family);
CREATE INDEX IF NOT EXISTS taxa_genus_idx   ON ingester.taxa (genus);

-- Resolved accepted-taxon key for each identification. Populated by the
-- resolver in a follow-up branch; until then, NULL on every row.
ALTER TABLE ingester.identifications
    ADD COLUMN IF NOT EXISTS accepted_taxon_key BIGINT;
