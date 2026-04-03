//! WebSocket subscription client for QuickSlice using the graphql-ws protocol.
//!
//! Reference: <https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md>

use futures_util::{SinkExt, StreamExt};
use serde::{de::DeserializeOwned, Deserialize};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

/// A single subscription event delivered from the server.
#[derive(Debug)]
pub struct SubscriptionEvent<T> {
    pub id: String,
    pub data: T,
}

/// graphql-ws protocol messages (server → client).
#[derive(Deserialize)]
struct ServerMessage {
    #[serde(rename = "type")]
    msg_type: String,
    id: Option<String>,
    payload: Option<serde_json::Value>,
}

/// Run a set of GraphQL subscriptions over a single WebSocket connection.
///
/// `subscriptions` is a list of `(id, query)` pairs. Each query should be a
/// GraphQL subscription string (e.g., `subscription { orgRwellTestLikeCreated { uri did } }`).
///
/// Events are sent to the returned channel as raw JSON `serde_json::Value` payloads
/// tagged with the subscription ID.
pub async fn subscribe(
    ws_url: &str,
    subscriptions: Vec<(String, String)>,
) -> crate::Result<mpsc::UnboundedReceiver<SubscriptionEvent<serde_json::Value>>> {
    let (tx, rx) = mpsc::unbounded_channel();

    let url = ws_url.to_string();
    let subs = subscriptions.clone();

    tokio::spawn(async move {
        loop {
            match run_connection(&url, &subs, &tx).await {
                Ok(()) => {
                    info!("QuickSlice subscription connection closed cleanly");
                }
                Err(e) => {
                    error!(error = %e, "QuickSlice subscription connection error");
                }
            }

            // Reconnect after a delay
            info!("Reconnecting to QuickSlice subscriptions in 5s...");
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });

    Ok(rx)
}

async fn run_connection(
    ws_url: &str,
    subscriptions: &[(String, String)],
    tx: &mpsc::UnboundedSender<SubscriptionEvent<serde_json::Value>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (ws_stream, _) =
        tokio_tungstenite::connect_async(format!("{ws_url}?protocol=graphql-ws")).await?;
    let (mut write, mut read) = ws_stream.split();

    debug!("WebSocket connected to {ws_url}");

    // connection_init
    write
        .send(Message::Text(
            serde_json::json!({"type": "connection_init"}).to_string().into(),
        ))
        .await?;

    // Wait for connection_ack
    while let Some(msg) = read.next().await {
        let msg = msg?;
        if let Message::Text(text) = &msg {
            let server_msg: ServerMessage = serde_json::from_str(text)?;
            if server_msg.msg_type == "connection_ack" {
                debug!("Received connection_ack");
                break;
            }
        }
    }

    // Send all subscription requests
    for (id, query) in subscriptions {
        let subscribe_msg = serde_json::json!({
            "id": id,
            "type": "subscribe",
            "payload": {
                "query": query,
            }
        });
        write
            .send(Message::Text(subscribe_msg.to_string().into()))
            .await?;
        debug!(id = %id, "Sent subscription");
    }

    // Process incoming messages
    while let Some(msg) = read.next().await {
        let msg = msg?;
        match msg {
            Message::Text(text) => {
                let server_msg: ServerMessage = match serde_json::from_str(&text) {
                    Ok(m) => m,
                    Err(e) => {
                        warn!(error = %e, "Failed to parse server message");
                        continue;
                    }
                };

                match server_msg.msg_type.as_str() {
                    "next" => {
                        if let (Some(id), Some(payload)) = (server_msg.id, server_msg.payload) {
                            if let Some(data) = payload.get("data").cloned() {
                                let _ = tx.send(SubscriptionEvent { id, data });
                            }
                        }
                    }
                    "error" => {
                        warn!(id = ?server_msg.id, payload = ?server_msg.payload, "Subscription error");
                    }
                    "complete" => {
                        debug!(id = ?server_msg.id, "Subscription completed");
                    }
                    "ping" => {
                        write
                            .send(Message::Text(
                                serde_json::json!({"type": "pong"}).to_string().into(),
                            ))
                            .await?;
                    }
                    _ => {}
                }
            }
            Message::Ping(data) => {
                write.send(Message::Pong(data)).await?;
            }
            Message::Close(_) => {
                info!("WebSocket closed by server");
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

/// Helper to deserialize a subscription event's data into a typed value.
/// The `field_name` is the top-level field in the `data` object (e.g., "orgRwellTestLikeCreated").
pub fn parse_event<T: DeserializeOwned>(
    event: &SubscriptionEvent<serde_json::Value>,
    field_name: &str,
) -> Option<T> {
    event
        .data
        .get(field_name)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}
