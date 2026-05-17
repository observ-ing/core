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

/// SPDX license identifiers accepted across the appview. Mirrors `knownValues`
/// on `bio.lexicons.temp.v0-1.media#license` so neither the user_preferences
/// table nor the PDS media record ever holds a value the lexicon would reject.
pub const ALLOWED_LICENSES: &[&str] = &[
    "CC0-1.0",
    "CC-BY-4.0",
    "CC-BY-NC-4.0",
    "CC-BY-SA-4.0",
    "CC-BY-NC-SA-4.0",
];

pub fn validate_license(value: &str) -> Result<(), AppError> {
    if !ALLOWED_LICENSES.contains(&value) {
        return Err(AppError::BadRequest(format!(
            "Unknown license value: {value}"
        )));
    }
    Ok(())
}
