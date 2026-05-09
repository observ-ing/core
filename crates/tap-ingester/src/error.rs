//! Error types for tap-ingester.

use std::fmt;

#[derive(Debug)]
pub enum IngesterError {
    Database(Box<sqlx::Error>),
    Decode(String),
    Config(String),
}

impl fmt::Display for IngesterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            IngesterError::Database(err) => write!(f, "Database error: {}", err),
            IngesterError::Decode(msg) => write!(f, "Decode error: {}", msg),
            IngesterError::Config(msg) => write!(f, "Configuration error: {}", msg),
        }
    }
}

impl std::error::Error for IngesterError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            IngesterError::Database(err) => Some(err.as_ref()),
            _ => None,
        }
    }
}

impl From<sqlx::Error> for IngesterError {
    fn from(err: sqlx::Error) -> Self {
        IngesterError::Database(Box::new(err))
    }
}

impl From<serde_json::Error> for IngesterError {
    fn from(err: serde_json::Error) -> Self {
        IngesterError::Decode(err.to_string())
    }
}

impl From<tracing_subscriber::filter::ParseError> for IngesterError {
    fn from(err: tracing_subscriber::filter::ParseError) -> Self {
        IngesterError::Config(err.to_string())
    }
}

impl From<std::io::Error> for IngesterError {
    fn from(err: std::io::Error) -> Self {
        IngesterError::Config(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, IngesterError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_error_display() {
        let err = IngesterError::Decode("invalid format".to_string());
        assert_eq!(format!("{}", err), "Decode error: invalid format");
    }

    #[test]
    fn test_config_error_display() {
        let err = IngesterError::Config("missing DATABASE_URL".to_string());
        assert_eq!(
            format!("{}", err),
            "Configuration error: missing DATABASE_URL"
        );
    }

    #[test]
    fn test_error_is_debug() {
        let err = IngesterError::Decode("x".to_string());
        let debug_str = format!("{:?}", err);
        assert!(debug_str.contains("Decode"));
    }
}
