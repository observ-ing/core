//! Observ.ing Ingester Library
//!
//! Provides the core components for the AT Protocol firehose ingester.

pub mod database;
pub mod error;
pub mod server;
pub mod types;

pub use database::Database;
pub use error::{IngesterError, Result};
pub use server::{create_router, start_server, ServerState, SharedState};
pub use types::*;
