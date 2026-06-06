//! Shared bootstrap helpers for observ.ing binaries.
//!
//! Two independent, feature-gated halves:
//! - [`serve`] (feature `http`) — bind + serve an axum app, for HTTP services.
//! - [`job`] (feature `job`) — scaffolding for one-shot batch jobs (data
//!   backfills, replays).
//!
//! Note: tracing/log initialization is intentionally *not* centralized here —
//! services and jobs configure their own subscribers (structured Stackdriver
//! vs. plain fmt), so that decision stays at the binary.

#[cfg(feature = "http")]
mod http;
#[cfg(feature = "http")]
pub use http::serve;

#[cfg(feature = "job")]
pub mod job;
