//! AT Protocol Tap WebSocket Client (spike)
//!
//! Connects to a [Tap](https://github.com/bluesky-social/indigo/tree/main/cmd/tap)
//! instance and consumes events from its `/channel` endpoint, including the
//! ack handshake required for at-least-once delivery.

pub mod error;
pub mod event;
pub mod subscription;

pub use error::{Result, TapError};
pub use event::{IdentityEvent, RecordEvent, TapEvent};
pub use subscription::{AckSender, TapConfig, TapSubscription};
