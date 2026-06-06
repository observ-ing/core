//! HTTP service scaffolding.

use std::net::SocketAddr;

/// Bind an axum app to `0.0.0.0:<port>` and serve it until the process exits.
///
/// Centralizes the `SocketAddr::from(([0, 0, 0, 0], port))` →
/// `TcpListener::bind` → `axum::serve` sequence that every HTTP service
/// repeated. Binding to `0.0.0.0` (all interfaces) is required for the Cloud
/// Run TCP startup probe to reach the container.
///
/// Returns the bind/serve [`std::io::Error`] to the caller; the message logged
/// on startup includes the resolved address.
pub async fn serve(router: axum::Router, port: u16) -> std::io::Result<()> {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Starting HTTP server on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await
}
