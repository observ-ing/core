//! Cache-control and security-header [`axum`] middleware for serving a
//! single-page app built with content-addressed (hashed) assets.
//!
//! Two concerns, independent of each other:
//!
//! - [`cache_control`] sets `Cache-Control` per request path: `no-cache` on
//!   entry points (so a deploy is picked up on the next load instead of taking
//!   two reloads), and a long-lived `immutable` directive on hashed assets.
//!   Wire it with [`axum::middleware::from_fn_with_state`].
//! - [`security_headers`] applies `X-Content-Type-Options`, `X-Frame-Options`,
//!   and optional HSTS to a response. Wire it with
//!   [`axum::middleware::map_response`].
//!
//! ```ignore
//! use std::sync::Arc;
//! use axum::middleware::{from_fn_with_state, map_response};
//! use axum_static_spa::{cache_control, security_headers, CacheControl, SecurityHeaders};
//!
//! let sec = SecurityHeaders::new().hsts(is_production);
//! let app = router
//!     .layer(map_response(move |res| security_headers(res, sec)))
//!     .layer(from_fn_with_state(Arc::new(CacheControl::vite()), cache_control));
//! ```

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{header, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;

/// Standard security response headers, with optional HSTS.
#[derive(Clone, Copy, Debug, Default)]
pub struct SecurityHeaders {
    /// Emit `Strict-Transport-Security`. Only meaningful over HTTPS, so
    /// typically enabled in production only.
    pub hsts: bool,
}

impl SecurityHeaders {
    /// Headers with HSTS disabled.
    pub fn new() -> Self {
        Self::default()
    }

    /// Enable or disable the `Strict-Transport-Security` header.
    pub fn hsts(mut self, enabled: bool) -> Self {
        self.hsts = enabled;
        self
    }

    /// Apply the configured headers to `response` in place.
    ///
    /// - `X-Content-Type-Options: nosniff` — prevents MIME-type sniffing.
    /// - `X-Frame-Options: DENY` — prevents clickjacking.
    /// - `Strict-Transport-Security` — enforces HTTPS (only when `hsts`).
    pub fn apply(&self, response: &mut Response) {
        let headers = response.headers_mut();
        headers.insert(
            "X-Content-Type-Options",
            HeaderValue::from_static("nosniff"),
        );
        headers.insert("X-Frame-Options", HeaderValue::from_static("DENY"));
        if self.hsts {
            headers.insert(
                "Strict-Transport-Security",
                HeaderValue::from_static("max-age=63072000; includeSubDomains"),
            );
        }
    }
}

/// `map_response` adapter for [`SecurityHeaders`].
///
/// ```ignore
/// let sec = SecurityHeaders::new().hsts(true);
/// router.layer(axum::middleware::map_response(move |res| security_headers(res, sec)));
/// ```
pub async fn security_headers(mut response: Response, config: SecurityHeaders) -> Response {
    config.apply(&mut response);
    response
}

/// Per-path `Cache-Control` policy for a static frontend.
///
/// Without this, browsers fall back to heuristic freshness on `index.html` and
/// the service worker — so a deploy can take two reloads to surface (the first
/// reload pulls a stale `index.html` that still references the previous asset
/// hash). `no-cache` forces a conditional GET so revisiting users always
/// revalidate the entry points; content-addressed assets are `immutable`.
#[derive(Clone, Debug)]
pub struct CacheControl {
    /// Exact request paths that should always revalidate (`no-cache`).
    pub revalidate: Vec<String>,
    /// Request-path prefixes for content-addressed assets, served with a
    /// one-year `immutable` directive.
    pub immutable_prefixes: Vec<String>,
}

impl CacheControl {
    /// Sensible defaults for a Vite + Workbox PWA build: the HTML entry point,
    /// service-worker / PWA registration files, and the web manifest
    /// revalidate; `/assets/` and `/workbox-*` are immutable.
    pub fn vite() -> Self {
        Self {
            revalidate: [
                "/",
                "/index.html",
                "/sw.js",
                "/registerSW.js",
                "/manifest.webmanifest",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
            immutable_prefixes: ["/assets/", "/workbox-"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        }
    }

    /// The `Cache-Control` value for `path`, if this policy covers it.
    fn directive_for(&self, path: &str) -> Option<&'static str> {
        if self.revalidate.iter().any(|p| p == path) {
            Some("no-cache")
        } else if self
            .immutable_prefixes
            .iter()
            .any(|p| path.starts_with(p.as_str()))
        {
            Some("public, max-age=31536000, immutable")
        } else {
            None
        }
    }
}

/// `from_fn_with_state` middleware that applies a [`CacheControl`] policy.
///
/// ```ignore
/// use std::sync::Arc;
/// router.layer(axum::middleware::from_fn_with_state(
///     Arc::new(CacheControl::vite()),
///     axum_static_spa::cache_control,
/// ));
/// ```
pub async fn cache_control(
    State(config): State<Arc<CacheControl>>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path().to_owned();
    let mut response = next.run(req).await;
    if let Some(value) = config.directive_for(&path) {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vite_revalidates_entry_points() {
        let cc = CacheControl::vite();
        assert_eq!(cc.directive_for("/"), Some("no-cache"));
        assert_eq!(cc.directive_for("/index.html"), Some("no-cache"));
        assert_eq!(cc.directive_for("/sw.js"), Some("no-cache"));
        assert_eq!(cc.directive_for("/manifest.webmanifest"), Some("no-cache"));
    }

    #[test]
    fn vite_marks_hashed_assets_immutable() {
        let cc = CacheControl::vite();
        assert_eq!(
            cc.directive_for("/assets/index-abc123.js"),
            Some("public, max-age=31536000, immutable")
        );
        assert_eq!(
            cc.directive_for("/workbox-1a2b3c.js"),
            Some("public, max-age=31536000, immutable")
        );
    }

    #[test]
    fn vite_leaves_other_paths_untouched() {
        let cc = CacheControl::vite();
        assert_eq!(cc.directive_for("/api/things"), None);
        assert_eq!(cc.directive_for("/some/page"), None);
    }
}
