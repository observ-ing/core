//! Error types for the Observ.ing media proxy

use std::fmt;

#[derive(Debug)]
pub enum MediaProxyError {
    #[allow(dead_code)]
    Cache(String),
    BlobResolver(atproto_blob_resolver::BlobResolverError),
    Io(Box<std::io::Error>),
    Config(String),
}

impl fmt::Display for MediaProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MediaProxyError::Cache(msg) => write!(f, "Cache error: {}", msg),
            MediaProxyError::BlobResolver(err) => write!(f, "Blob resolver error: {}", err),
            MediaProxyError::Io(err) => write!(f, "IO error: {}", err),
            MediaProxyError::Config(msg) => write!(f, "Configuration error: {}", msg),
        }
    }
}

impl std::error::Error for MediaProxyError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            MediaProxyError::BlobResolver(err) => Some(err),
            MediaProxyError::Io(err) => Some(err.as_ref()),
            _ => None,
        }
    }
}

impl From<atproto_blob_resolver::BlobResolverError> for MediaProxyError {
    fn from(err: atproto_blob_resolver::BlobResolverError) -> Self {
        MediaProxyError::BlobResolver(err)
    }
}

impl From<std::io::Error> for MediaProxyError {
    fn from(err: std::io::Error) -> Self {
        MediaProxyError::Io(Box::new(err))
    }
}

impl From<tracing_subscriber::filter::ParseError> for MediaProxyError {
    fn from(err: tracing_subscriber::filter::ParseError) -> Self {
        MediaProxyError::Config(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, MediaProxyError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_error_display() {
        let err = MediaProxyError::Cache("disk full".to_string());
        assert_eq!(format!("{}", err), "Cache error: disk full");
    }

    #[test]
    fn test_blob_resolver_error_display() {
        let err = MediaProxyError::BlobResolver(
            atproto_blob_resolver::BlobResolverError::DidResolution(
                "invalid DID format".to_string(),
            ),
        );
        assert!(format!("{}", err).contains("invalid DID format"));
    }

    #[test]
    fn test_config_error_display() {
        let err = MediaProxyError::Config("missing CACHE_DIR".to_string());
        assert_eq!(format!("{}", err), "Configuration error: missing CACHE_DIR");
    }

    #[test]
    fn test_error_is_debug() {
        let err = MediaProxyError::Cache("test".to_string());
        let debug_str = format!("{:?}", err);
        assert!(debug_str.contains("Cache"));
    }
}
