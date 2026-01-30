//! Error types for taxonomy service

use std::fmt;

#[derive(Debug)]
pub enum TaxonomyError {
    /// HTTP request failed
    Http(reqwest::Error),
    /// Failed to parse JSON response
    Json(serde_json::Error),
    /// Configuration error
    Config(String),
}

impl fmt::Display for TaxonomyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Http(e) => write!(f, "HTTP error: {}", e),
            Self::Json(e) => write!(f, "JSON parse error: {}", e),
            Self::Config(msg) => write!(f, "Configuration error: {}", msg),
        }
    }
}

impl std::error::Error for TaxonomyError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Http(e) => Some(e),
            Self::Json(e) => Some(e),
            _ => None,
        }
    }
}

impl From<reqwest::Error> for TaxonomyError {
    fn from(e: reqwest::Error) -> Self {
        Self::Http(e)
    }
}

impl From<serde_json::Error> for TaxonomyError {
    fn from(e: serde_json::Error) -> Self {
        Self::Json(e)
    }
}

impl From<tracing_subscriber::filter::ParseError> for TaxonomyError {
    fn from(e: tracing_subscriber::filter::ParseError) -> Self {
        Self::Config(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, TaxonomyError>;
