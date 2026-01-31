//! Error types for GBIF API client

use std::fmt;

/// Errors that can occur when interacting with the GBIF API
#[derive(Debug)]
pub enum GbifError {
    /// HTTP request failed
    Http(reqwest::Error),
    /// Failed to parse JSON response
    Json(serde_json::Error),
}

impl fmt::Display for GbifError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Http(e) => write!(f, "GBIF HTTP error: {}", e),
            Self::Json(e) => write!(f, "GBIF JSON parse error: {}", e),
        }
    }
}

impl std::error::Error for GbifError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Http(e) => Some(e),
            Self::Json(e) => Some(e),
        }
    }
}

impl From<reqwest::Error> for GbifError {
    fn from(e: reqwest::Error) -> Self {
        Self::Http(e)
    }
}

impl From<serde_json::Error> for GbifError {
    fn from(e: serde_json::Error) -> Self {
        Self::Json(e)
    }
}

/// Result type for GBIF API operations
pub type Result<T> = std::result::Result<T, GbifError>;
