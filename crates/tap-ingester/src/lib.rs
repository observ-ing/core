//! The parts of the ingester that don't care where records come from: the
//! Postgres write path, record dispatch, and the counters the dashboard reads.
//!
//! The `tap-ingester` binary feeds them from Tap; the `hydrant-ingester`
//! spike feeds them from an embedded hydrant.

pub mod database;
pub mod error;
pub mod lag_probe;
mod media_resolver;
pub mod records;
pub mod server;
pub mod types;
