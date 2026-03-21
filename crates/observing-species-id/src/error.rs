//! Error types for species identification service

use std::fmt;

#[derive(Debug)]
pub enum SpeciesIdError {
    /// ONNX model error
    Model(String),
    /// Image processing error
    Image(String),
    /// I/O error
    Io(std::io::Error),
    /// Configuration error
    Config(String),
}

impl fmt::Display for SpeciesIdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Model(msg) => write!(f, "Model error: {}", msg),
            Self::Image(msg) => write!(f, "Image error: {}", msg),
            Self::Io(e) => write!(f, "I/O error: {}", e),
            Self::Config(msg) => write!(f, "Configuration error: {}", msg),
        }
    }
}

impl std::error::Error for SpeciesIdError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for SpeciesIdError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<image::ImageError> for SpeciesIdError {
    fn from(e: image::ImageError) -> Self {
        Self::Image(e.to_string())
    }
}

impl From<tracing_subscriber::filter::ParseError> for SpeciesIdError {
    fn from(e: tracing_subscriber::filter::ParseError) -> Self {
        Self::Config(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, SpeciesIdError>;
