//! AT Protocol Blob Resolver
//!
//! Resolves AT Protocol DIDs to PDS endpoints and fetches blobs.
//! Supports did:plc (via plc.directory) and did:web resolution.

pub mod error;
pub mod resolver;
pub mod types;

pub use error::{BlobResolverError, Result};
pub use resolver::BlobResolver;
pub use types::{PlcDirectoryResponse, PlcService};
