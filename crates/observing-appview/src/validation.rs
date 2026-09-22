use crate::error::AppError;

/// Validate that a string's length falls within the given range (inclusive).
pub fn validate_string_length(
    value: &str,
    min: usize,
    max: usize,
    field_name: &str,
) -> Result<(), AppError> {
    if value.len() < min || value.len() > max {
        return Err(AppError::BadRequest(format!(
            "{field_name} must be {min}-{max} characters"
        )));
    }
    Ok(())
}

/// License URIs accepted across the appview. Mirrors `knownValues` on
/// `bio.lexicons.temp.v0-1.media#license` so neither the user_preferences
/// table nor the PDS media record ever holds a value the lexicon would reject.
pub const ALLOWED_LICENSES: &[&str] = &[
    "https://creativecommons.org/publicdomain/zero/1.0/",
    "https://creativecommons.org/licenses/by/4.0/",
    "https://creativecommons.org/licenses/by-nc/4.0/",
    "https://creativecommons.org/licenses/by-sa/4.0/",
    "https://creativecommons.org/licenses/by-nc-sa/4.0/",
];

/// SPDX identifiers the lexicon used before it moved to license URIs, mapped to
/// their canonical replacement. Records written under the old schema keep these
/// values in their author's PDS forever — we can't rewrite user-owned repos —
/// so both the read path and the write path translate through this table.
pub const LEGACY_SPDX_LICENSES: &[(&str, &str)] = &[
    (
        "CC0-1.0",
        "https://creativecommons.org/publicdomain/zero/1.0/",
    ),
    ("CC-BY-4.0", "https://creativecommons.org/licenses/by/4.0/"),
    (
        "CC-BY-NC-4.0",
        "https://creativecommons.org/licenses/by-nc/4.0/",
    ),
    (
        "CC-BY-SA-4.0",
        "https://creativecommons.org/licenses/by-sa/4.0/",
    ),
    (
        "CC-BY-NC-SA-4.0",
        "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    ),
];

/// Resolve a license — in either the current URI form or the retired SPDX form —
/// to its canonical URI. Returns `None` for anything we don't recognize.
pub fn normalize_license(value: &str) -> Option<&'static str> {
    ALLOWED_LICENSES
        .iter()
        .find(|uri| **uri == value)
        .copied()
        .or_else(|| {
            LEGACY_SPDX_LICENSES
                .iter()
                .find(|(spdx, _)| *spdx == value)
                .map(|(_, uri)| *uri)
        })
}

/// Validate a client-supplied license and return the canonical URI to store.
/// Legacy SPDX identifiers are accepted rather than rejected so a client running
/// a stale bundle — or replaying a preference saved under the old schema — keeps
/// working instead of failing its upload.
pub fn validate_license(value: &str) -> Result<&'static str, AppError> {
    normalize_license(value)
        .ok_or_else(|| AppError::BadRequest(format!("Unknown license value: {value}")))
}

/// Map basemap ids offered by the selector. Mirrors the `BasemapId` union in
/// `frontend/src/components/map/mapStyle.ts`, so the stored preference can't
/// hold a value the client doesn't recognize.
pub const ALLOWED_BASEMAPS: &[&str] = &["outdoor", "topo", "streets", "satellite"];

pub fn validate_basemap(value: &str) -> Result<(), AppError> {
    if !ALLOWED_BASEMAPS.contains(&value) {
        return Err(AppError::BadRequest(format!(
            "Unknown basemap value: {value}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_license_passes_canonical_uris_through() {
        for uri in ALLOWED_LICENSES {
            assert_eq!(normalize_license(uri), Some(*uri));
        }
    }

    #[test]
    fn normalize_license_upgrades_legacy_spdx() {
        assert_eq!(
            normalize_license("CC-BY-4.0"),
            Some("https://creativecommons.org/licenses/by/4.0/")
        );
        assert_eq!(
            normalize_license("CC0-1.0"),
            Some("https://creativecommons.org/publicdomain/zero/1.0/")
        );
    }

    #[test]
    fn every_legacy_alias_maps_to_an_allowed_license() {
        for (_, uri) in LEGACY_SPDX_LICENSES {
            assert!(
                ALLOWED_LICENSES.contains(uri),
                "{uri} is not an allowed license"
            );
        }
    }

    #[test]
    fn normalize_license_rejects_unknown_values() {
        assert_eq!(normalize_license("https://example.com/license"), None);
        assert_eq!(normalize_license("MIT"), None);
        assert_eq!(normalize_license(""), None);
    }

    #[test]
    fn validate_license_returns_the_canonical_value() {
        assert_eq!(
            validate_license("CC-BY-SA-4.0").unwrap(),
            "https://creativecommons.org/licenses/by-sa/4.0/"
        );
        assert!(validate_license("MIT").is_err());
    }

    #[test]
    fn allowed_licenses_fit_the_lexicon_max_length() {
        // bio.lexicons.temp.v0-1.media#license caps `license` at 128 chars.
        for uri in ALLOWED_LICENSES {
            assert!(uri.len() <= 128, "{uri} exceeds the lexicon maxLength");
        }
    }
}
