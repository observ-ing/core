//! Validated DID (Decentralized Identifier) newtype.
//!
//! This is a **proof-of-concept** step toward addressing stringly-typed DIDs
//! across the codebase. Today, DIDs flow through the system as plain `String`s,
//! which means every site that consumes one has to re-validate or trust the
//! caller. A newtype makes the invariants ("starts with `did:plc:` or
//! `did:web:`, matches the AT Protocol DID syntax") a property of the type
//! system instead of a runtime assumption.
//!
//! Only this module uses `Did` so far — migrating call sites is intentionally
//! left to follow-up PRs, so reviewers can evaluate the type's shape in
//! isolation before committing to a sweep.
//!
//! Validation follows the [AT Protocol DID spec][spec]:
//!
//! * Overall length ≤ 2048 bytes.
//! * Only the ASCII character set `A-Z a-z 0-9 . - _ : %` (percent-encoding is
//!   allowed but not decoded — `did:web:localhost%3A3000` round-trips
//!   verbatim).
//! * Must not end with `:` or `-`.
//! * `did:plc:<id>` — `<id>` is exactly 24 characters of lowercase base32
//!   (`a-z`, `2-7`).
//! * `did:web:<host>` — `<host>` is non-empty. Full hostname validation is
//!   left to the resolver so percent-encoded ports continue to pass through.
//!
//! [spec]: https://atproto.com/specs/did

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Maximum length of a DID string, per the AT Protocol DID spec.
const MAX_DID_LEN: usize = 2048;

/// Length of the method-specific identifier for `did:plc:`.
const PLC_ID_LEN: usize = 24;

/// A parsed AT Protocol DID.
///
/// Construct with [`Did::parse`] (or `"…".parse::<Did>()`). The stored string
/// is guaranteed to:
///
/// * start with a supported method prefix (`did:plc:` or `did:web:`),
/// * have a non-empty, well-formed method-specific identifier, and
/// * satisfy the AT Protocol DID syntax rules (length, character set, no
///   trailing separator).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Did(String);

/// DID method discriminant, with a borrowed view of the method-specific part.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DidMethod<'a> {
    /// `did:plc:<id>` — placeholder method, resolved via plc.directory.
    /// `<id>` is always 24 characters of lowercase base32.
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
    /// The DID exceeded the 2048-byte maximum length.
    TooLong,
    /// The DID contained a character outside the AT Protocol DID syntax set.
    InvalidCharacter,
    /// The DID ended with `:` or `-`, which the spec forbids.
    InvalidTrailingCharacter,
    /// A `did:plc:` identifier was not exactly 24 chars of lowercase base32.
    InvalidPlcIdentifier,
}

impl fmt::Display for DidParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedMethod => {
                f.write_str("unsupported DID method (expected did:plc: or did:web:)")
            }
            Self::EmptyIdentifier => f.write_str("DID method-specific identifier is empty"),
            Self::TooLong => f.write_str("DID exceeds maximum length of 2048 bytes"),
            Self::InvalidCharacter => f.write_str(
                "DID contains a character outside the allowed set (A-Z a-z 0-9 . - _ : %)",
            ),
            Self::InvalidTrailingCharacter => f.write_str("DID must not end with ':' or '-'"),
            Self::InvalidPlcIdentifier => {
                f.write_str("did:plc: identifier must be 24 chars of lowercase base32 (a-z, 2-7)")
            }
        }
    }
}

impl std::error::Error for DidParseError {}

impl Did {
    /// Parse a string into a validated DID.
    pub fn parse(s: &str) -> Result<Self, DidParseError> {
        if s.len() > MAX_DID_LEN {
            return Err(DidParseError::TooLong);
        }

        // Method detection runs first so "did:plc:" reports EmptyIdentifier
        // rather than being caught by the trailing-`:` rule below.
        if let Some(rest) = s.strip_prefix("did:plc:") {
            if rest.is_empty() {
                return Err(DidParseError::EmptyIdentifier);
            }
            validate_did_syntax(s)?;
            if !is_valid_plc_id(rest) {
                return Err(DidParseError::InvalidPlcIdentifier);
            }
        } else if let Some(rest) = s.strip_prefix("did:web:") {
            if rest.is_empty() {
                return Err(DidParseError::EmptyIdentifier);
            }
            validate_did_syntax(s)?;
        } else {
            return Err(DidParseError::UnsupportedMethod);
        }

        Ok(Did(s.to_owned()))
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
            // Unreachable: `parse` is the only constructor and it rejects
            // anything that does not start with a supported prefix.
            unreachable!("Did constructed without a supported method prefix")
        }
    }
}

/// Apply the method-agnostic AT Protocol DID syntax rules: allowed character
/// set and no trailing `:` / `-`.
fn validate_did_syntax(s: &str) -> Result<(), DidParseError> {
    if !s.bytes().all(is_valid_did_byte) {
        return Err(DidParseError::InvalidCharacter);
    }
    match s.as_bytes().last() {
        Some(b':') | Some(b'-') => Err(DidParseError::InvalidTrailingCharacter),
        _ => Ok(()),
    }
}

/// ATProto DID grammar: `ALPHA / DIGIT / "." / "-" / "_" / ":" / "%"`.
fn is_valid_did_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b':' | b'%')
}

/// `did:plc:` identifiers are exactly 24 chars of lowercase base32 (RFC 4648,
/// alphabet `a-z2-7`).
fn is_valid_plc_id(id: &str) -> bool {
    id.len() == PLC_ID_LEN && id.bytes().all(|b| matches!(b, b'a'..=b'z' | b'2'..=b'7'))
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

impl FromStr for Did {
    type Err = DidParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}

impl Serialize for Did {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Did {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Did::parse(&s).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_PLC: &str = "did:plc:abcdefghijklmnopqrstuvwx"; // 24 chars a-z
    const VALID_PLC_ID: &str = "abcdefghijklmnopqrstuvwx";

    #[test]
    fn parses_did_plc() {
        let did = Did::parse(VALID_PLC).unwrap();
        assert_eq!(did.as_str(), VALID_PLC);
        assert_eq!(did.method(), DidMethod::Plc(VALID_PLC_ID));
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
            Did::parse("did:key:z6Mk"),
            Err(DidParseError::UnsupportedMethod)
        );
        assert_eq!(
            Did::parse("https://example.com"),
            Err(DidParseError::UnsupportedMethod)
        );
    }

    #[test]
    fn rejects_empty_identifier() {
        assert_eq!(Did::parse("did:plc:"), Err(DidParseError::EmptyIdentifier));
        assert_eq!(Did::parse("did:web:"), Err(DidParseError::EmptyIdentifier));
    }

    #[test]
    fn rejects_too_long() {
        let long = format!("did:web:{}", "a".repeat(MAX_DID_LEN));
        assert_eq!(Did::parse(&long), Err(DidParseError::TooLong));
    }

    #[test]
    fn rejects_invalid_character() {
        // `/` is outside the ATProto DID char set.
        assert_eq!(
            Did::parse("did:web:example.com/path"),
            Err(DidParseError::InvalidCharacter)
        );
        // Whitespace is rejected.
        assert_eq!(
            Did::parse("did:web:example .com"),
            Err(DidParseError::InvalidCharacter)
        );
    }

    #[test]
    fn rejects_trailing_separator() {
        assert_eq!(
            Did::parse("did:web:example.com-"),
            Err(DidParseError::InvalidTrailingCharacter)
        );
        // Trailing `:` is caught before empty-identifier because the suffix
        // is non-empty here ("example.com:").
        assert_eq!(
            Did::parse("did:web:example.com:"),
            Err(DidParseError::InvalidTrailingCharacter)
        );
    }

    #[test]
    fn rejects_invalid_plc_identifier() {
        // Wrong length.
        assert_eq!(
            Did::parse("did:plc:abc"),
            Err(DidParseError::InvalidPlcIdentifier)
        );
        // Uppercase base32 is not allowed — ATProto requires lowercase.
        assert_eq!(
            Did::parse("did:plc:ABCDEFGHIJKLMNOPQRSTUVWX"),
            Err(DidParseError::InvalidPlcIdentifier)
        );
        // `0` and `1` are outside the RFC 4648 base32 alphabet.
        assert_eq!(
            Did::parse("did:plc:0bcdefghijklmnopqrstuvwx"),
            Err(DidParseError::InvalidPlcIdentifier)
        );
    }

    #[test]
    fn display_round_trips() {
        let did = Did::parse(VALID_PLC).unwrap();
        assert_eq!(did.to_string(), VALID_PLC);
    }

    #[test]
    fn parses_via_from_str() {
        let did: Did = VALID_PLC.parse().unwrap();
        assert_eq!(did.as_str(), VALID_PLC);

        let err: Result<Did, _> = "not-a-did".parse();
        assert_eq!(err, Err(DidParseError::UnsupportedMethod));
    }

    #[test]
    fn serde_round_trips() {
        let did = Did::parse(VALID_PLC).unwrap();
        let json = serde_json::to_string(&did).unwrap();
        assert_eq!(json, format!("\"{VALID_PLC}\""));
        let back: Did = serde_json::from_str(&json).unwrap();
        assert_eq!(back, did);
    }

    #[test]
    fn serde_rejects_invalid() {
        let err = serde_json::from_str::<Did>("\"did:key:nope\"").unwrap_err();
        assert!(err.to_string().contains("unsupported DID method"));
    }
}
