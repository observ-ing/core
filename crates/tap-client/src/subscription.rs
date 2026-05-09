//! Tap WebSocket subscription with ack handshake.
//!
//! Connects to a Tap instance's `/channel` endpoint (default `ws://localhost:2480/channel`),
//! reads JSON event frames, and forwards them to the consumer's mpsc. The consumer
//! acks each event by sending its id on the [`AckSender`] returned from [`TapSubscription::new`].
//!
//! Reconnects on disconnect with exponential backoff, mirroring `jetstream-client`.

use crate::error::{Result, TapError};
use crate::event::{TapEvent, WireFrame};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};
use tracing::{debug, error, info, warn};

const DEFAULT_URL: &str = "ws://localhost:2480/channel";
const MAX_RECONNECT_ATTEMPTS: u32 = 10;
const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(1);
const ACK_CHANNEL_CAPACITY: usize = 1024;

/// Configuration for the Tap subscription.
pub struct TapConfig {
    /// Full WebSocket URL, e.g. `ws://localhost:2480/channel`.
    pub url: String,
    /// Optional admin password if Tap is configured with `TAP_ADMIN_PASSWORD`.
    pub admin_password: Option<String>,
}

impl Default for TapConfig {
    fn default() -> Self {
        Self {
            url: DEFAULT_URL.to_string(),
            admin_password: None,
        }
    }
}

/// Handle returned alongside the subscription that the consumer uses to
/// acknowledge processed events.
#[derive(Clone)]
pub struct AckSender {
    tx: mpsc::Sender<u64>,
}

impl AckSender {
    /// Acknowledge an event by id. Errors only if the subscription has been
    /// dropped or its connection has terminated.
    pub async fn ack(&self, id: u64) -> Result<()> {
        self.tx
            .send(id)
            .await
            .map_err(|_| TapError::AckChannelClosed)
    }
}

#[derive(Serialize)]
struct AckMessage<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    id: u64,
}

pub struct TapSubscription {
    config: TapConfig,
    event_tx: mpsc::Sender<TapEvent>,
    ack_rx: mpsc::Receiver<u64>,
}

impl TapSubscription {
    /// Build a subscription. Returns the subscription itself plus an
    /// [`AckSender`] cloneable handle the consumer uses to ack events.
    pub fn new(
        config: TapConfig,
        event_tx: mpsc::Sender<TapEvent>,
    ) -> (Self, AckSender) {
        let (ack_tx, ack_rx) = mpsc::channel(ACK_CHANNEL_CAPACITY);
        (
            Self {
                config,
                event_tx,
                ack_rx,
            },
            AckSender { tx: ack_tx },
        )
    }

    /// Run the subscription until the ack sender is dropped or the maximum
    /// reconnect attempts are exhausted.
    pub async fn run(&mut self) -> Result<()> {
        let mut reconnect_attempts = 0;

        loop {
            match self.connect_and_stream().await {
                Ok(()) => {
                    info!("Tap connection closed cleanly");
                    return Ok(());
                }
                Err(e) => {
                    error!("Tap error: {}", e);
                    if let Err(send_err) = self
                        .event_tx
                        .send(TapEvent::Error(e.to_string()))
                        .await
                    {
                        warn!(error = %send_err, "Failed to send error event to consumer");
                    }

                    reconnect_attempts += 1;
                    if reconnect_attempts >= MAX_RECONNECT_ATTEMPTS {
                        return Err(TapError::MaxReconnectAttempts);
                    }
                    let delay = INITIAL_RECONNECT_DELAY * 2u32.pow(reconnect_attempts - 1);
                    warn!(
                        "Reconnecting in {:?} (attempt {}/{})",
                        delay, reconnect_attempts, MAX_RECONNECT_ATTEMPTS
                    );
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }

    async fn connect_and_stream(&mut self) -> Result<()> {
        info!("Connecting to Tap: {}", self.config.url);

        let mut request = self
            .config
            .url
            .as_str()
            .into_client_request()
            .map_err(|e| TapError::JsonParse(format!("invalid Tap url: {}", e)))?;
        if let Some(password) = self.config.admin_password.as_ref() {
            let auth = format!("admin:{}", password);
            let encoded = B64.encode(auth.as_bytes());
            request.headers_mut().insert(
                "Authorization",
                format!("Basic {}", encoded).parse().map_err(|_| {
                    TapError::JsonParse("invalid admin password header value".to_string())
                })?,
            );
        }

        let (ws_stream, _) = connect_async(request).await?;
        let (mut write, mut read) = ws_stream.split();

        if let Err(e) = self.event_tx.send(TapEvent::Connected).await {
            warn!(error = %e, "Failed to send connected event to consumer");
        }
        info!("Tap connection established");

        loop {
            tokio::select! {
                msg = read.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            if let Err(e) = self.handle_text(&text).await {
                                debug!("Error processing message: {}", e);
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            info!("Tap WebSocket closed by server");
                            let _ = self.event_tx.send(TapEvent::Disconnected).await;
                            return Ok(());
                        }
                        Some(Ok(_)) => {
                            // Ignore binary, ping, pong frames.
                        }
                        Some(Err(e)) => {
                            error!("WebSocket read error: {}", e);
                            let _ = self.event_tx.send(TapEvent::Disconnected).await;
                            return Err(e.into());
                        }
                    }
                }
                ack_id = self.ack_rx.recv() => {
                    let Some(id) = ack_id else {
                        info!("Ack channel closed, shutting down subscription");
                        let _ = write.send(Message::Close(None)).await;
                        return Ok(());
                    };
                    let payload = serde_json::to_string(&AckMessage { kind: "ack", id })?;
                    if let Err(e) = write.send(Message::Text(payload.into())).await {
                        error!("Failed to send ack for id={}: {}", id, e);
                        return Err(e.into());
                    }
                    debug!("acked id={}", id);
                }
            }
        }
    }

    async fn handle_text(&self, text: &str) -> Result<()> {
        let frame: WireFrame = serde_json::from_str(text)?;
        let kind = frame.kind.clone();
        if let Some(evt) = frame.into_event() {
            if let Err(e) = self.event_tx.send(evt).await {
                warn!(error = %e, "consumer dropped event channel");
            }
        } else {
            return Err(TapError::InvalidEventType(kind));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_default() {
        let c = TapConfig::default();
        assert_eq!(c.url, DEFAULT_URL);
        assert!(c.admin_password.is_none());
    }

    #[test]
    fn ack_message_serializes_correctly() {
        let ack = AckMessage { kind: "ack", id: 42 };
        let s = serde_json::to_string(&ack).unwrap();
        assert_eq!(s, r#"{"type":"ack","id":42}"#);
    }

    #[tokio::test]
    async fn ack_sender_send_ok() {
        let (event_tx, _event_rx) = mpsc::channel(10);
        let (_sub, ack) = TapSubscription::new(TapConfig::default(), event_tx);
        // The receiver lives in `_sub`, so this should succeed.
        ack.ack(7).await.unwrap();
    }

    #[tokio::test]
    async fn ack_sender_send_after_drop_errors() {
        let (event_tx, _event_rx) = mpsc::channel(10);
        let (sub, ack) = TapSubscription::new(TapConfig::default(), event_tx);
        drop(sub);
        let err = ack.ack(7).await.unwrap_err();
        assert!(matches!(err, TapError::AckChannelClosed));
    }
}
