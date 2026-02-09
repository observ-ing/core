//! AT Protocol Jetstream WebSocket Client
//!
//! A generic client for connecting to Bluesky's Jetstream service,
//! which provides filtered firehose access over WebSocket with JSON messages.

pub mod error;
pub mod event;
pub mod subscription;

pub use error::{JetstreamError, Result};
pub use event::{CommitInfo, JetstreamEvent, TimingInfo};
pub use subscription::{JetstreamConfig, JetstreamSubscription};
