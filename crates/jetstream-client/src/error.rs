//! Error types for the Jetstream client

use std::fmt;

#[derive(Debug)]
pub enum JetstreamError {
    WebSocket(Box<tokio_tungstenite::tungstenite::Error>),
    JsonParse(String),
    MaxReconnectAttempts,
    ConnectionClosed,
}

impl fmt::Display for JetstreamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            JetstreamError::WebSocket(err) => write!(f, "WebSocket error: {}", err),
            JetstreamError::JsonParse(msg) => write!(f, "JSON parse error: {}", msg),
            JetstreamError::MaxReconnectAttempts => {
                write!(f, "Max reconnection attempts reached")
            }
            JetstreamError::ConnectionClosed => write!(f, "Connection closed"),
        }
    }
}

impl std::error::Error for JetstreamError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            JetstreamError::WebSocket(err) => Some(err.as_ref()),
            _ => None,
        }
    }
}

impl From<tokio_tungstenite::tungstenite::Error> for JetstreamError {
    fn from(err: tokio_tungstenite::tungstenite::Error) -> Self {
        JetstreamError::WebSocket(Box::new(err))
    }
}

impl From<serde_json::Error> for JetstreamError {
    fn from(err: serde_json::Error) -> Self {
        JetstreamError::JsonParse(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, JetstreamError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_json_parse_error_display() {
        let err = JetstreamError::JsonParse("unexpected token".to_string());
        assert_eq!(format!("{}", err), "JSON parse error: unexpected token");
    }

    #[test]
    fn test_max_reconnect_attempts_display() {
        let err = JetstreamError::MaxReconnectAttempts;
        assert_eq!(format!("{}", err), "Max reconnection attempts reached");
    }

    #[test]
    fn test_connection_closed_display() {
        let err = JetstreamError::ConnectionClosed;
        assert_eq!(format!("{}", err), "Connection closed");
    }

    #[test]
    fn test_error_is_debug() {
        let err = JetstreamError::ConnectionClosed;
        let debug_str = format!("{:?}", err);
        assert!(debug_str.contains("ConnectionClosed"));
    }
}
