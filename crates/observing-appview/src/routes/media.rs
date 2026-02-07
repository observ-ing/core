use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use tracing::error;

use crate::state::AppState;

/// GET /media/{*path}
/// Proxies requests to the media-proxy service, forwarding Content-Type and Cache-Control headers.
pub async fn proxy(State(state): State<AppState>, Path(path): Path<String>) -> Response {
    let target_url = format!("{}/{}", state.media_proxy_url, path);

    let client = reqwest::Client::new();
    match client.get(&target_url).send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                return (
                    StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
                    resp.status().canonical_reason().unwrap_or("Error"),
                )
                    .into_response();
            }

            let mut builder = Response::builder().status(StatusCode::OK);

            if let Some(ct) = resp.headers().get(reqwest::header::CONTENT_TYPE) {
                if let Ok(v) = ct.to_str() {
                    builder = builder.header(header::CONTENT_TYPE, v);
                }
            }
            if let Some(cc) = resp.headers().get(reqwest::header::CACHE_CONTROL) {
                if let Ok(v) = cc.to_str() {
                    builder = builder.header(header::CACHE_CONTROL, v);
                }
            }

            // Stream the response body
            let stream = resp.bytes_stream();
            builder
                .body(Body::from_stream(stream))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(e) => {
            error!(error = %e, url = %target_url, "Media proxy error");
            (
                StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({ "error": "Media proxy unavailable" })),
            )
                .into_response()
        }
    }
}
