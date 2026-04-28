-- Drop the co-observer feature.
--
-- The `occurrence_observers` table held additional observer DIDs (role
-- `co-observer`) for an occurrence beyond its primary uploader. The feature
-- is being removed: only the primary observer (the occurrence's owning DID)
-- remains.

DROP INDEX IF EXISTS ingester.idx_occurrence_observers_did;
DROP TABLE IF EXISTS ingester.occurrence_observers;
