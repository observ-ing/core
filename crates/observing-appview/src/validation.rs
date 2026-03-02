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
