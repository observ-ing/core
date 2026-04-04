//! AT Protocol Identity Resolver
//!
//! Resolves AT Protocol identities (handles to DIDs and vice versa)
//! and fetches Bluesky profiles.
//! All lookups are cached using moka async caches.

mod resolver;
mod types;

pub use resolver::IdentityResolver;
pub use types::{Profile, ResolveResult};
