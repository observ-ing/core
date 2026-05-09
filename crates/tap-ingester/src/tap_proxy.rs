//! Reverse proxy from tap-ingester's HTTP server to the embedded Tap admin UI.
//!
//! Tap binds to `127.0.0.1:2480` inside the Cloud Run container, which means
//! its admin surface is unreachable from the public internet. Cloud Run only
//! exposes a single port (the ingester's), and there's no SSH/exec story for
//! Cloud Run instances. Mounting Tap's UI underneath `/tap/*` on the ingester
//! is the only practical way to inspect repo lists, pause channels, or trigger
//! manual `/repos/add` calls from outside the container.
//!
//! Auth: requests are forwarded as-is. Tap's existing Basic auth (gated by
//! `TAP_ADMIN_PASSWORD`) is the only check — the proxy itself adds none. Don't
//! deploy without `TAP_ADMIN_PASSWORD` set in production.

use axum::{
    body::Body,
    extract::{Path, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode},
    response::Response,
};
use reqwest::Client;
use std::str::FromStr;
use tracing::warn;

#[derive(Clone)]
pub struct TapProxy {
    upstream: String,
    client: Client,
}

impl TapProxy {
    pub fn new(upstream: impl Into<String>) -> Self {
        let upstream = upstream.into().trim_end_matches('/').to_string();
        Self {
            upstream,
            client: Client::new(),
        }
    }
}

/// Hop-by-hop headers that must not be forwarded across a proxy boundary.
/// (RFC 9110 §7.6.1.) `host` is also stripped because reqwest sets its own.
fn is_hop_header(name: &str) -> bool {
    matches!(
        name,
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailers"
            | "transfer-encoding"
            | "upgrade"
            | "host"
            | "content-length"
    )
}

fn copy_headers(src: &HeaderMap, dst: &mut HeaderMap) {
    for (name, value) in src.iter() {
        if is_hop_header(name.as_str()) {
            continue;
        }
        dst.insert(name.clone(), value.clone());
    }
}

pub async fn proxy(
    State(proxy): State<TapProxy>,
    Path(path): Path<String>,
    req: Request<Body>,
) -> Result<Response, StatusCode> {
    let method = req.method().clone();
    let headers = req.headers().clone();
    let query = req
        .uri()
        .query()
        .map(|q| format!("?{q}"))
        .unwrap_or_default();
    let body_bytes = axum::body::to_bytes(req.into_body(), usize::MAX)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let target = format!("{}/{}{}", proxy.upstream, path, query);
    let upstream_method =
        reqwest::Method::from_str(method.as_str()).map_err(|_| StatusCode::BAD_REQUEST)?;
    let mut builder = proxy.client.request(upstream_method, &target);
    let mut forwarded = HeaderMap::new();
    copy_headers(&headers, &mut forwarded);
    builder = builder.headers(forwarded).body(body_bytes.to_vec());

    let resp = match builder.send().await {
        Ok(r) => r,
        Err(e) => {
            warn!(target = %target, error = %e, "tap proxy upstream request failed");
            return Err(StatusCode::BAD_GATEWAY);
        }
    };

    let status = resp.status();
    let mut out = Response::builder().status(status.as_u16());
    if let Some(headers_mut) = out.headers_mut() {
        for (name, value) in resp.headers().iter() {
            if is_hop_header(name.as_str()) {
                continue;
            }
            if let (Ok(n), Ok(v)) = (
                HeaderName::from_bytes(name.as_str().as_bytes()),
                HeaderValue::from_bytes(value.as_bytes()),
            ) {
                headers_mut.insert(n, v);
            }
        }
    }
    let bytes = resp.bytes().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    out.body(Body::from(bytes))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// Convenience: bare `/tap` (no trailing path) — Tap's UI lives at the root,
/// so we forward to upstream `/`.
pub async fn proxy_root(
    State(state): State<TapProxy>,
    req: Request<Body>,
) -> Result<Response, StatusCode> {
    proxy(State(state), Path(String::new()), req).await
}
