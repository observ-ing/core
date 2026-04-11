//! Validated DID (Decentralized Identifier) newtype.
//!
//! This is a **proof-of-concept** step toward addressing stringly-typed DIDs
//! across the codebase. Today, DIDs flow through the system as plain `String`s,
//! which means every site that consumes one has to re-validate or trust the
//! caller. A newtype makes the invariants ("starts with `did:plc:` or
//! `did:web:`") a property of the type system instead of a runtime assumption.
//!
//! Only this module uses `Did` so far — migrating call sites is intentionally
//! left to follow-up PRs, so reviewers can evaluate the type's shape in
//! isolation before committing to a sweep.

use std::fmt;

/// A parsed AT Protocol DID.
///
/// Construct with [`Did::parse`]. The stored string is guaranteed to start
/// with a supported method prefix (`did:plc:` or `did:web:`) and to have a
/// non-empty method-specific identifier.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Did(String);

/// DID method discriminant, with a borrowed view of the method-specific part.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DidMethod<'a> {
    /// `did:plc:<id>` — placeholder method, resolved via plc.directory.
    Plc(&'a str),
    /// `did:web:<host>` — resolved via HTTPS at `<host>/.well-known/did.json`.
    /// `%3A` port-separator escaping is preserved as stored.
    Web(&'a str),
}

/// Errors produced by [`Did::parse`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DidParseError {
    /// The string did not begin with a supported `did:<method>:` prefix.
    UnsupportedMethod,
    /// The method-specific identifier (after the second colon) was empty.
    EmptyIdentifier,
}

impl fmt::Display for DidParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedMethod => {
                f.write_str("unsupported DID method (expected did:plc: or did:web:)")
            }
            Self::EmptyIdentifier => f.write_str("DID method-specific identifier is empty"),
        }
    }
}

impl std::error::Error for DidParseError {}

impl Did {
    /// Parse a string into a validated DID.
    pub fn parse(s: &str) -> Result<Self, DidParseError> {
        if let Some(rest) = s.strip_prefix("did:plc:") {
            if rest.is_empty() {
                return Err(DidParseError::EmptyIdentifier);
            }
            Ok(Did(s.to_owned()))
        } else if let Some(rest) = s.strip_prefix("did:web:") {
            if rest.is_empty() {
                return Err(DidParseError::EmptyIdentifier);
            }
            Ok(Did(s.to_owned()))
        } else {
            Err(DidParseError::UnsupportedMethod)
        }
    }

    /// Borrow the full DID string (`did:plc:...` or `did:web:...`).
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Classify the DID by method, exposing the method-specific suffix.
    pub fn method(&self) -> DidMethod<'_> {
        if let Some(rest) = self.0.strip_prefix("did:plc:") {
            DidMethod::Plc(rest)
        } else if let Some(rest) = self.0.strip_prefix("did:web:") {
            DidMethod::Web(rest)
        } else {
            // Unreachable: parse() is the only constructor and rejects
            // anything else, but we don't want to panic on a corrupted value.
            DidMethod::Plc("")
        }
    }
}

impl fmt::Display for Did {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for Did {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_did_plc() {
        let did = Did::parse("did:plc:abc123").unwrap();
        assert_eq!(did.as_str(), "did:plc:abc123");
        assert_eq!(did.method(), DidMethod::Plc("abc123"));
    }

    #[test]
    fn parses_did_web() {
        let did = Did::parse("did:web:example.com").unwrap();
        assert_eq!(did.as_str(), "did:web:example.com");
        assert_eq!(did.method(), DidMethod::Web("example.com"));
    }

    #[test]
    fn preserves_percent_encoded_port_in_did_web() {
        let did = Did::parse("did:web:localhost%3A3000").unwrap();
        assert_eq!(did.method(), DidMethod::Web("localhost%3A3000"));
    }

    #[test]
    fn rejects_unknown_method() {
        assert_eq!(
            Did::parse("did:key:z6Mk..."),
            Err(DidParseError::UnsupportedMethod)
        );
        assert_eq!(
            Did::parse("https://example.com"),
            Err(DidParseError::UnsupportedMethod)
        );
    }

    #[test]
    fn rejects_empty_identifier() {
        assert_eq!(
            Did::parse("did:plc:"),
            Err(DidParseError::EmptyIdentifier)
        );
        assert_eq!(
            Did::parse("did:web:"),
            Err(DidParseError::EmptyIdentifier)
        );
    }

    #[test]
    fn display_round_trips() {
        let did = Did::parse("did:plc:xyz").unwrap();
        assert_eq!(did.to_string(), "did:plc:xyz");
    }
}
