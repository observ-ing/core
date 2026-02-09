//! Error types for the AT Protocol blob resolver

use std::fmt;

#[derive(Debug)]
pub enum BlobResolverError {
    Http(Box<reqwest::Error>),
    DidResolution(String),
}

impl fmt::Display for BlobResolverError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BlobResolverError::Http(err) => write!(f, "HTTP error: {}", err),
            BlobResolverError::DidResolution(msg) => write!(f, "DID resolution error: {}", msg),
        }
    }
}

impl std::error::Error for BlobResolverError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            BlobResolverError::Http(err) => Some(err.as_ref()),
            _ => None,
        }
    }
}

impl From<reqwest::Error> for BlobResolverError {
    fn from(err: reqwest::Error) -> Self {
        BlobResolverError::Http(Box::new(err))
    }
}

pub type Result<T> = std::result::Result<T, BlobResolverError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_did_resolution_error_display() {
        let err = BlobResolverError::DidResolution("invalid DID format".to_string());
        assert_eq!(
            format!("{}", err),
            "DID resolution error: invalid DID format"
        );
    }

    #[test]
    fn test_error_is_debug() {
        let err = BlobResolverError::DidResolution("test".to_string());
        let debug_str = format!("{:?}", err);
        assert!(debug_str.contains("DidResolution"));
    }
}
