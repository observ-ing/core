//! AT Protocol Identity Resolver
//!
//! Resolves AT Protocol identities (handles to DIDs and vice versa)
//! and fetches Bluesky profiles.
//! All lookups are cached using moka async caches.

mod did;
mod resolver;
mod types;

pub use did::{DidExt, DidMethod};
pub use resolver::IdentityResolver;
pub use types::{Profile, ResolveResult};

/// Validated AT Protocol DID, backed by jacquard's `Did` (default `SmolStr`
/// backing). jacquard owns the syntax validation; [`DidExt`] adds method
/// classification on top.
pub type Did = jacquard_common::types::string::Did;

/// Base URL of the PLC directory used to resolve `did:plc:` documents.
///
/// Overridable via the `PLC_DIRECTORY_URL` env var so the stack can be pointed
/// at a local `@atproto/dev-env` PLC for isolated e2e tests; falls back to the
/// public directory. The returned value never has a trailing slash, so callers
/// can build URLs as `format!("{base}/{did}")`.
pub fn plc_directory_url() -> String {
    std::env::var("PLC_DIRECTORY_URL")
        .ok()
        .map(|s| s.trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://plc.directory".to_string())
}
