//! Error types for the BioSky ingester

use thiserror::Error;

#[derive(Error, Debug)]
#[allow(dead_code)]
pub enum IngesterError {
    #[error("WebSocket error: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("CBOR decode error: {0}")]
    CborDecode(String),

    #[error("Invalid frame: {0}")]
    InvalidFrame(String),

    #[error("Connection closed")]
    ConnectionClosed,

    #[error("Max reconnection attempts reached")]
    MaxReconnectAttempts,

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Parse error: {0}")]
    Parse(String),
}

impl From<ciborium::de::Error<std::io::Error>> for IngesterError {
    fn from(err: ciborium::de::Error<std::io::Error>) -> Self {
        IngesterError::CborDecode(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, IngesterError>;
