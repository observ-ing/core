-- Preferences for posting new observations to iNaturalist (#998).

-- Whether new observations are cross-posted to iNaturalist by default. NULL
-- means the user never chose, which the client treats as off.
ALTER TABLE appview.user_preferences
    ADD COLUMN crosspost_inaturalist BOOLEAN;

-- Whether that default applies only to observations with photos. NULL means
-- the user never chose, which the client treats as on.
ALTER TABLE appview.user_preferences
    ADD COLUMN crosspost_inaturalist_require_photos BOOLEAN;
