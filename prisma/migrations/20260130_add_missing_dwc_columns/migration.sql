-- Add missing Darwin Core location and taxonomy columns to occurrences table
-- These columns were added to the schema but never migrated

-- Location fields
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "continent" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "country_code" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "state_province" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "county" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "municipality" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "locality" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "water_body" TEXT;

-- Taxonomy fields
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "taxon_id" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "taxon_rank" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "vernacular_name" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "kingdom" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "phylum" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "class" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "order" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "family" TEXT;
ALTER TABLE "occurrences" ADD COLUMN IF NOT EXISTS "genus" TEXT;
