//! Error types for the Observ.ing ingester

use std::fmt;

#[derive(Debug)]
#[allow(dead_code)]
pub enum IngesterError {
    WebSocket(Box<tokio_tungstenite::tungstenite::Error>),
    Database(Box<sqlx::Error>),
    CborDecode(String),
    InvalidFrame(String),
    ConnectionClosed,
    MaxReconnectAttempts,
    Config(String),
    Parse(String),
}

impl fmt::Display for IngesterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            IngesterError::WebSocket(err) => write!(f, "WebSocket error: {}", err),
            IngesterError::Database(err) => write!(f, "Database error: {}", err),
            IngesterError::CborDecode(msg) => write!(f, "CBOR decode error: {}", msg),
            IngesterError::InvalidFrame(msg) => write!(f, "Invalid frame: {}", msg),
            IngesterError::ConnectionClosed => write!(f, "Connection closed"),
            IngesterError::MaxReconnectAttempts => write!(f, "Max reconnection attempts reached"),
            IngesterError::Config(msg) => write!(f, "Configuration error: {}", msg),
            IngesterError::Parse(msg) => write!(f, "Parse error: {}", msg),
        }
    }
}

impl std::error::Error for IngesterError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            IngesterError::WebSocket(err) => Some(err.as_ref()),
            IngesterError::Database(err) => Some(err.as_ref()),
            _ => None,
        }
    }
}

impl From<tokio_tungstenite::tungstenite::Error> for IngesterError {
    fn from(err: tokio_tungstenite::tungstenite::Error) -> Self {
        IngesterError::WebSocket(Box::new(err))
    }
}

impl From<sqlx::Error> for IngesterError {
    fn from(err: sqlx::Error) -> Self {
        IngesterError::Database(Box::new(err))
    }
}

impl From<serde_json::Error> for IngesterError {
    fn from(err: serde_json::Error) -> Self {
        IngesterError::CborDecode(err.to_string())
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
    fn test_cbor_decode_error_display() {
        let err = IngesterError::CborDecode("invalid format".to_string());
        assert_eq!(format!("{}", err), "CBOR decode error: invalid format");
    }

    #[test]
    fn test_invalid_frame_error_display() {
        let err = IngesterError::InvalidFrame("missing header".to_string());
        assert_eq!(format!("{}", err), "Invalid frame: missing header");
    }

    #[test]
    fn test_connection_closed_error_display() {
        let err = IngesterError::ConnectionClosed;
        assert_eq!(format!("{}", err), "Connection closed");
    }

    #[test]
    fn test_max_reconnect_attempts_error_display() {
        let err = IngesterError::MaxReconnectAttempts;
        assert_eq!(format!("{}", err), "Max reconnection attempts reached");
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
    fn test_parse_error_display() {
        let err = IngesterError::Parse("invalid integer".to_string());
        assert_eq!(format!("{}", err), "Parse error: invalid integer");
    }

    #[test]
    fn test_error_is_debug() {
        let err = IngesterError::ConnectionClosed;
        let debug_str = format!("{:?}", err);
        assert!(debug_str.contains("ConnectionClosed"));
    }
}
