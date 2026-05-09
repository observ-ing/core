//! Error types for the Tap client

use std::fmt;

#[derive(Debug)]
pub enum TapError {
    WebSocket(Box<tokio_tungstenite::tungstenite::Error>),
    JsonParse(String),
    InvalidEventType(String),
    MaxReconnectAttempts,
    ConnectionClosed,
    AckChannelClosed,
}

impl fmt::Display for TapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TapError::WebSocket(err) => write!(f, "WebSocket error: {}", err),
            TapError::JsonParse(msg) => write!(f, "JSON parse error: {}", msg),
            TapError::InvalidEventType(t) => write!(f, "unknown Tap event type: {}", t),
            TapError::MaxReconnectAttempts => write!(f, "Max reconnection attempts reached"),
            TapError::ConnectionClosed => write!(f, "Connection closed"),
            TapError::AckChannelClosed => write!(f, "Ack channel closed before connection"),
        }
    }
}

impl std::error::Error for TapError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            TapError::WebSocket(err) => Some(err.as_ref()),
            _ => None,
        }
    }
}

impl From<tokio_tungstenite::tungstenite::Error> for TapError {
    fn from(err: tokio_tungstenite::tungstenite::Error) -> Self {
        TapError::WebSocket(Box::new(err))
    }
}

impl From<serde_json::Error> for TapError {
    fn from(err: serde_json::Error) -> Self {
        TapError::JsonParse(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, TapError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_event_type_display() {
        let err = TapError::InvalidEventType("commit".to_string());
        assert_eq!(format!("{}", err), "unknown Tap event type: commit");
    }

    #[test]
    fn test_ack_channel_closed_display() {
        let err = TapError::AckChannelClosed;
        assert_eq!(format!("{}", err), "Ack channel closed before connection");
    }
}
