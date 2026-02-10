//! AT Protocol Identity Resolver
//!
//! Resolves AT Protocol identities (handles to DIDs and vice versa),
//! fetches Bluesky profiles, and retrieves follow graphs.
//! All lookups are cached using moka async caches.

mod resolver;
mod types;

pub use resolver::IdentityResolver;
pub use types::{Profile, ResolveResult};
