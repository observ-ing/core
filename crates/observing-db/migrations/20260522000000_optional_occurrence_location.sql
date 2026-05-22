-- The bio.lexicons.temp.v0-1.occurrence lexicon marks decimalLatitude,
-- decimalLongitude, and eventDate as optional (no `required` array in
-- the schema). Survey-based records carry those values on a referenced
-- bio.lexicons.temp.v0-1.survey record via `eventID`, so the occurrence
-- itself has no inline coordinates or date.
--
-- The ingester was rejecting these records (silent drop pre-#508, then
-- failed_records entries post-#508) which in turn caused FK violations
-- when their identifications arrived. Allow NULL so the ledger drains
-- and identifications can land. Read queries in the appview filter
-- incomplete rows out (`WHERE location IS NOT NULL AND event_date IS NOT NULL`)
-- so the API contract is unchanged until proper survey support lands.

ALTER TABLE occurrences ALTER COLUMN location DROP NOT NULL;
ALTER TABLE occurrences ALTER COLUMN event_date DROP NOT NULL;
