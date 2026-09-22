-- bio.lexicons.temp.v0-1.media.license moved from SPDX identifiers to Creative
-- Commons license URIs (lexicons.bio#35). Upgrade the saved upload defaults so
-- the settings selector still matches a known option and the value we write to
-- new media records is already canonical.
--
-- occurrences.associated_media is deliberately NOT rewritten here. It mirrors
-- media records living in each author's PDS, and the ingester re-derives the
-- column from those records on every re-ingest — any rewrite would be undone.
-- The appview normalizes those values on read instead (enrichment::extract_images),
-- which also covers records written by clients other than us.
UPDATE appview.user_preferences
SET default_license = CASE default_license
    WHEN 'CC0-1.0'         THEN 'https://creativecommons.org/publicdomain/zero/1.0/'
    WHEN 'CC-BY-4.0'       THEN 'https://creativecommons.org/licenses/by/4.0/'
    WHEN 'CC-BY-NC-4.0'    THEN 'https://creativecommons.org/licenses/by-nc/4.0/'
    WHEN 'CC-BY-SA-4.0'    THEN 'https://creativecommons.org/licenses/by-sa/4.0/'
    WHEN 'CC-BY-NC-SA-4.0' THEN 'https://creativecommons.org/licenses/by-nc-sa/4.0/'
    ELSE default_license
END
WHERE default_license IS NOT NULL;
