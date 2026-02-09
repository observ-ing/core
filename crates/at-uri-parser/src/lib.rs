//! Parser for AT Protocol URIs
//!
//! Parses URIs of the form `at://did/collection/rkey` into their component parts.

use regex::Regex;
use std::sync::LazyLock;

/// Parsed components of an AT Protocol URI
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AtUri {
    pub did: String,
    pub collection: String,
    pub rkey: String,
}

static AT_URI_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^at://([^/]+)/([^/]+)/([^/]+)$").unwrap());

impl AtUri {
    /// Parse an AT Protocol URI like "at://did:plc:xxx/collection/rkey"
    pub fn parse(uri: &str) -> Option<Self> {
        let caps = AT_URI_RE.captures(uri)?;
        Some(Self {
            did: caps[1].to_string(),
            collection: caps[2].to_string(),
            rkey: caps[3].to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_uri() {
        let uri = AtUri::parse("at://did:plc:abc123/org.rwell.test.occurrence/rkey1").unwrap();
        assert_eq!(uri.did, "did:plc:abc123");
        assert_eq!(uri.collection, "org.rwell.test.occurrence");
        assert_eq!(uri.rkey, "rkey1");
    }

    #[test]
    fn test_parse_missing_rkey() {
        assert!(AtUri::parse("at://did:plc:abc123/org.rwell.test.occurrence").is_none());
    }

    #[test]
    fn test_parse_empty_string() {
        assert!(AtUri::parse("").is_none());
    }

    #[test]
    fn test_parse_no_at_prefix() {
        assert!(AtUri::parse("did:plc:abc123/org.rwell.test.occurrence/rkey1").is_none());
    }

    #[test]
    fn test_parse_extra_slash_in_rkey() {
        assert!(AtUri::parse("at://did:plc:abc123/collection/rkey/extra").is_none());
    }

    #[test]
    fn test_parse_did_web() {
        let uri = AtUri::parse("at://did:web:example.com/app.bsky.feed.like/abc").unwrap();
        assert_eq!(uri.did, "did:web:example.com");
        assert_eq!(uri.collection, "app.bsky.feed.like");
        assert_eq!(uri.rkey, "abc");
    }
}
