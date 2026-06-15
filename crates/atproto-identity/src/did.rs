//! DID method discrimination layered on jacquard's validated `Did`.
//!
//! The DID newtype itself now comes from [`jacquard_common`], which validates
//! the full AT Protocol DID syntax (see <https://atproto.com/specs/did>). This
//! module keeps only the observ.ing-specific piece jacquard does not provide:
//! classifying a DID by method (`did:plc:` vs `did:web:`) so the resolver knows
//! how to fetch its document.

use jacquard_common::types::string::Did;

/// DID method discriminant, with a borrowed view of the method-specific part.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DidMethod<'a> {
    /// `did:plc:<id>` — placeholder method, resolved via plc.directory.
    Plc(&'a str),
    /// `did:web:<host>` — resolved via HTTPS at `<host>/.well-known/did.json`.
    /// `%3A` port-separator escaping is preserved as stored.
    Web(&'a str),
}

/// Classify a [`Did`] by its method.
pub trait DidExt {
    /// Return the [`DidMethod`] for this DID, or `None` for methods other than
    /// `did:plc:` / `did:web:` (which observ.ing treats as unsupported).
    ///
    /// jacquard guarantees the value is a syntactically valid `did:<method>:<id>`,
    /// so the only `None` case is an unsupported method.
    fn method(&self) -> Option<DidMethod<'_>>;
}

impl DidExt for Did {
    fn method(&self) -> Option<DidMethod<'_>> {
        let s = self.as_str();
        if let Some(rest) = s.strip_prefix("did:plc:") {
            Some(DidMethod::Plc(rest))
        } else {
            s.strip_prefix("did:web:").map(DidMethod::Web)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plc_method() {
        let did = Did::new_owned("did:plc:abcdefghijklmnopqrstuvwx").unwrap();
        assert_eq!(
            did.method(),
            Some(DidMethod::Plc("abcdefghijklmnopqrstuvwx"))
        );
    }

    #[test]
    fn web_method_preserves_port_escaping() {
        let did = Did::new_owned("did:web:localhost%3A3000").unwrap();
        assert_eq!(did.method(), Some(DidMethod::Web("localhost%3A3000")));
    }

    #[test]
    fn unsupported_method_is_none() {
        // Syntactically valid per jacquard, but not a method the resolver handles.
        let did = Did::new_owned("did:key:z6Mk").unwrap();
        assert_eq!(did.method(), None);
    }
}
