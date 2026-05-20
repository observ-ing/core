//! Error types for the audio identification service.

use std::fmt;

#[derive(Debug)]
pub enum AudioIdError {
    /// ONNX model error
    Model(String),
    /// Audio decoding / resampling / framing error
    Audio(String),
    /// I/O error
    Io(std::io::Error),
    /// Configuration error
    Config(String),
}

impl fmt::Display for AudioIdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Model(msg) => write!(f, "Model error: {}", msg),
            Self::Audio(msg) => write!(f, "Audio error: {}", msg),
            Self::Io(e) => write!(f, "I/O error: {}", e),
            Self::Config(msg) => write!(f, "Configuration error: {}", msg),
        }
    }
}

impl std::error::Error for AudioIdError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for AudioIdError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<tracing_subscriber::filter::ParseError> for AudioIdError {
    fn from(e: tracing_subscriber::filter::ParseError) -> Self {
        Self::Config(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AudioIdError>;
