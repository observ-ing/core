use std::fmt;

/// Errors from the Nominatim client
#[derive(Debug)]
pub enum NominatimError {
    InvalidCoordinates(f64, f64),
    Http(reqwest::Error),
    ApiError(String),
}

impl fmt::Display for NominatimError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCoordinates(lat, lng) => {
                write!(f, "Invalid coordinates: {lat}, {lng}")
            }
            Self::Http(e) => write!(f, "HTTP error: {e}"),
            Self::ApiError(msg) => write!(f, "API error: {msg}"),
        }
    }
}

impl std::error::Error for NominatimError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Http(e) => Some(e),
            _ => None,
        }
    }
}

impl From<reqwest::Error> for NominatimError {
    fn from(err: reqwest::Error) -> Self {
        Self::Http(err)
    }
}

pub type Result<T> = std::result::Result<T, NominatimError>;
