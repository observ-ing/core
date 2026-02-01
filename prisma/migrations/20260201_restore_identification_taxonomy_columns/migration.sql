-- Restore taxonomy columns to identifications table
-- These were accidentally removed in 20260131_sync_schema_with_database
-- but are needed for Darwin Core compliance (Tier 3 of darwin-core-roadmap.md)

-- Subject index for multi-subject occurrences (e.g., butterfly on a flower)
ALTER TABLE "identifications" ADD COLUMN IF NOT EXISTS "subject_index" INTEGER NOT NULL DEFAULT 0;

-- Darwin Core taxonomy fields (snapshot at time of identification)
ALTER TABLE "identifications" ADD COLUMN IF NOT EXISTS "vernacular_name" TEXT;
ALTER TABLE "identifications" ADD COLUMN IF NOT EXISTS "kingdom" TEXT;
ALTER TABLE "identifications" ADD COLUMN IF NOT EXISTS "phylum" TEXT;
ALTER TABLE "identifications" ADD COLUMN IF NOT EXISTS "class" TEXT;
ALTER TABLE "identifications" ADD COLUMN IF NOT EXISTS "order" TEXT;
ALTER TABLE "identifications" ADD COLUMN IF NOT EXISTS "family" TEXT;
ALTER TABLE "identifications" ADD COLUMN IF NOT EXISTS "genus" TEXT;
ALTER TABLE "identifications" ADD COLUMN IF NOT EXISTS "confidence" TEXT;

-- Index for querying identifications by subject
CREATE INDEX IF NOT EXISTS "identifications_subject_idx" ON "identifications" ("subject_uri", "subject_index");
