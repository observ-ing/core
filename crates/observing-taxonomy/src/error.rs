//! Error types for taxonomy service

use std::fmt;

#[derive(Debug)]
pub enum TaxonomyError {
    /// GBIF API error
    Gbif(gbif_api::GbifError),
    /// Configuration error
    Config(String),
}

impl fmt::Display for TaxonomyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Gbif(e) => write!(f, "{}", e),
            Self::Config(msg) => write!(f, "Configuration error: {}", msg),
        }
    }
}

impl std::error::Error for TaxonomyError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Gbif(e) => Some(e),
            Self::Config(_) => None,
        }
    }
}

impl From<gbif_api::GbifError> for TaxonomyError {
    fn from(e: gbif_api::GbifError) -> Self {
        Self::Gbif(e)
    }
}

impl From<tracing_subscriber::filter::ParseError> for TaxonomyError {
    fn from(e: tracing_subscriber::filter::ParseError) -> Self {
        Self::Config(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, TaxonomyError>;
