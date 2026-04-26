-- Drop `vernacular_name` from occurrences and identifications. The ingester
-- always writes NULL for this column (the AT-Protocol record doesn't carry
-- a common name), so the persisted value was never useful. Common names
-- are now resolved at read time via the GBIF taxonomy client, which is the
-- only authoritative source.

ALTER TABLE occurrences DROP COLUMN IF EXISTS vernacular_name;
ALTER TABLE identifications DROP COLUMN IF EXISTS vernacular_name;
