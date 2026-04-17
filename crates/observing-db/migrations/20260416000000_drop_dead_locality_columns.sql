-- Drop locality / remarks columns on `occurrences` that were defined in the
-- initial migration but are not referenced by any SELECT, INSERT, or UPDATE
-- in the workspace, nor by the `bio.lexicons.temp.occurrence` lexicon that
-- the ingester deserializes.

ALTER TABLE occurrences DROP COLUMN IF EXISTS occurrence_remarks;
ALTER TABLE occurrences DROP COLUMN IF EXISTS continent;
ALTER TABLE occurrences DROP COLUMN IF EXISTS country;
ALTER TABLE occurrences DROP COLUMN IF EXISTS country_code;
ALTER TABLE occurrences DROP COLUMN IF EXISTS state_province;
ALTER TABLE occurrences DROP COLUMN IF EXISTS county;
ALTER TABLE occurrences DROP COLUMN IF EXISTS municipality;
ALTER TABLE occurrences DROP COLUMN IF EXISTS locality;
ALTER TABLE occurrences DROP COLUMN IF EXISTS water_body;
ALTER TABLE occurrences DROP COLUMN IF EXISTS verbatim_locality;
