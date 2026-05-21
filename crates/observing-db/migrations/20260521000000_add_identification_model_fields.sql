-- Identifications authored by AI models carry the model name + version as
-- columns parallel to the human-supplied taxonomy. Stored as app-specific
-- extras on the AT Protocol record until the bio.lexicons schema picks up
-- formal fields for them.
ALTER TABLE identifications
    ADD COLUMN IF NOT EXISTS model_name TEXT,
    ADD COLUMN IF NOT EXISTS model_version TEXT;

CREATE INDEX IF NOT EXISTS identifications_model_name_idx
    ON identifications(model_name)
    WHERE model_name IS NOT NULL;
