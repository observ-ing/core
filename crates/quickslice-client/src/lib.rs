//! GraphQL client for querying a QuickSlice AppView instance.
//!
//! QuickSlice stores AT Protocol records as JSONB and auto-generates a GraphQL API
//! from Lexicon schemas. This crate provides typed queries for the observ-ing lexicons.

mod client;
mod error;
pub mod queries;
pub mod subscription;
pub mod types;

pub use client::QuickSliceClient;
pub use error::{QuickSliceError, Result};
