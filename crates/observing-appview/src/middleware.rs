use std::sync::Arc;

use axum::extract::Request;
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use url::Url;

/// Adds security headers to all responses.
///
/// - `X-Content-Type-Options: nosniff` — prevents MIME-type sniffing
/// - `X-Frame-Options: DENY` — prevents clickjacking
/// - `Strict-Transport-Security` — enforces HTTPS (production only)
pub async fn security_headers(mut response: Response, is_production: bool) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("X-Frame-Options", HeaderValue::from_static("DENY"));
    if is_production {
        headers.insert(
            "Strict-Transport-Security",
            HeaderValue::from_static("max-age=63072000; includeSubDomains"),
        );
    }
    response
}

/// Which origins may make state-changing requests.
///
/// The session cookie is `SameSite=None` (the Capacitor app calls us
/// cross-site), so the browser attaches it to requests from any site. CORS
/// stops a cross-site page reading replies and blocks JSON bodies (they need
/// a preflight), but a plain form or `fetch` with a "simple" body — e.g.
/// `POST /oauth/logout`, or raw bytes to `/api/media/heic-to-jpeg` — still
/// goes through. [`check_origin`] rejects those by their `Origin`.
#[derive(Debug, Clone)]
pub struct OriginPolicy {
    /// Exact origins (`scheme://host[:port]`), from `CORS_ORIGINS` and
    /// `PUBLIC_URL`.
    allowed: Vec<String>,
    /// `CORS_ORIGINS=*`: every origin is already trusted.
    allow_any: bool,
    /// Local dev: also trust any `localhost` / `127.0.0.1` origin, since the
    /// Vite dev server and process-compose ports vary.
    allow_loopback: bool,
}

impl OriginPolicy {
    pub fn new(cors_origins: &[String], public_url: Option<&str>) -> Self {
        let allowed = cors_origins
            .iter()
            .map(String::as_str)
            .chain(public_url)
            .filter_map(origin_of)
            .collect();
        Self {
            allowed,
            allow_any: cors_origins.iter().any(|o| o == "*"),
            allow_loopback: public_url.is_none(),
        }
    }

    /// Whether a request with these headers may change state.
    ///
    /// Requests with no `Origin` and no `Sec-Fetch-Site: cross-site` come
    /// from non-browser clients (the native app, Cloud Tasks, curl), which
    /// can't carry a victim's cookie, so they pass.
    fn allows(&self, headers: &HeaderMap) -> bool {
        let Some(origin) = headers.get(header::ORIGIN) else {
            return headers
                .get("sec-fetch-site")
                .is_none_or(|v| v.as_bytes() != b"cross-site");
        };
        if self.allow_any {
            return true;
        }
        // `Origin: null` (sandboxed frames, some redirects) never matches.
        let Some(origin) = origin.to_str().ok().and_then(origin_of) else {
            return false;
        };
        self.allowed.contains(&origin) || (self.allow_loopback && is_loopback_origin(&origin))
    }
}

/// `scheme://host[:port]` of a URL or origin, normalized (lowercase host,
/// default port dropped), or `None` if it has no host. Built by hand rather
/// than with `Url::origin`, which turns non-web schemes like `capacitor://`
/// into an opaque `null` that would match every other such scheme.
fn origin_of(url: &str) -> Option<String> {
    let url = Url::parse(url.trim()).ok()?;
    let host = url.host_str()?;
    Some(match url.port() {
        Some(port) => format!("{}://{host}:{port}", url.scheme()),
        None => format!("{}://{host}", url.scheme()),
    })
}

fn is_loopback_origin(origin: &str) -> bool {
    Url::parse(origin)
        .ok()
        .and_then(|u| {
            u.host_str()
                .map(|h| h == "localhost" || h == "127.0.0.1" || h == "[::1]")
        })
        .unwrap_or(false)
}

/// CSRF defence: rejects state-changing requests (anything but GET, HEAD and
/// OPTIONS) whose `Origin` isn't allowed by [`OriginPolicy`].
pub async fn check_origin(policy: Arc<OriginPolicy>, req: Request, next: Next) -> Response {
    let safe = matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    if !safe && !policy.allows(req.headers()) {
        tracing::warn!(
            method = %req.method(),
            path = %req.uri().path(),
            origin = ?req.headers().get(header::ORIGIN),
            "Rejecting cross-origin request"
        );
        return (StatusCode::FORBIDDEN, "Cross-origin request rejected").into_response();
    }
    next.run(req).await
}

/// Per-path `Cache-Control` for the static frontend.
///
/// Without this, browsers fall back to heuristic freshness on `index.html`
/// and `sw.js` — meaning a deploy can take two reloads to surface (the
/// first reload pulls a stale `index.html` from HTTP cache, which still
/// references the previous asset hash; only the second reload picks up
/// the new bundle). `no-cache` forces a conditional GET so revisiting
/// users always revalidate the entry points.
///
/// Hashed assets under `/assets/` and Workbox runtime files are content-
/// addressed, so they get a long-lived `immutable` directive.
pub async fn static_cache_control(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_owned();
    let mut response = next.run(req).await;

    let value: Option<&'static str> = match path.as_str() {
        "/" | "/index.html" | "/sw.js" | "/registerSW.js" | "/manifest.webmanifest" => {
            Some("no-cache")
        }
        p if p.starts_with("/assets/") || p.starts_with("/workbox-") => {
            Some("public, max-age=31536000, immutable")
        }
        _ => None,
    };

    if let Some(value) = value {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (k, v) in pairs {
            map.insert(
                axum::http::HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        map
    }

    fn production() -> OriginPolicy {
        OriginPolicy::new(
            &[
                "https://observ.ing".to_string(),
                "https://exact.observ.ing".to_string(),
                "capacitor://localhost".to_string(),
            ],
            Some("https://observ.ing/"),
        )
    }

    #[test]
    fn allowed_origins_pass() {
        let policy = production();
        for origin in [
            "https://observ.ing",
            "https://OBSERV.ing:443",
            "https://exact.observ.ing",
            "capacitor://localhost",
        ] {
            assert!(policy.allows(&headers(&[("origin", origin)])), "{origin}");
        }
    }

    #[test]
    fn other_origins_are_rejected() {
        let policy = production();
        for origin in [
            "https://evil.example",
            "http://observ.ing",
            "https://observ.ing.evil.example",
            "http://localhost:5173",
            "evil://localhost",
            "null",
            "",
        ] {
            assert!(!policy.allows(&headers(&[("origin", origin)])), "{origin}");
        }
    }

    #[test]
    fn requests_without_origin_pass_unless_marked_cross_site() {
        let policy = production();
        assert!(policy.allows(&headers(&[])));
        assert!(policy.allows(&headers(&[("sec-fetch-site", "same-origin")])));
        assert!(policy.allows(&headers(&[("sec-fetch-site", "none")])));
        assert!(!policy.allows(&headers(&[("sec-fetch-site", "cross-site")])));
    }

    #[test]
    fn dev_trusts_any_loopback_origin() {
        let policy = OriginPolicy::new(&["http://localhost:3000".to_string()], None);
        assert!(policy.allows(&headers(&[("origin", "http://127.0.0.1:5173")])));
        assert!(policy.allows(&headers(&[("origin", "http://localhost:4173")])));
        assert!(!policy.allows(&headers(&[("origin", "https://evil.example")])));
    }

    #[test]
    fn wildcard_cors_trusts_every_origin() {
        let policy = OriginPolicy::new(&["*".to_string()], Some("https://observ.ing"));
        assert!(policy.allows(&headers(&[("origin", "https://anything.example")])));
    }

    #[tokio::test]
    async fn middleware_rejects_cross_origin_posts_only() {
        use axum::routing::post;
        use tower::ServiceExt;

        let policy = Arc::new(production());
        let app = axum::Router::new()
            .route("/x", post(|| async { "ok" }).get(|| async { "ok" }))
            .layer(axum::middleware::from_fn(move |req, next| {
                check_origin(policy.clone(), req, next)
            }));
        let send = |method: Method, origin: &str| {
            let app = app.clone();
            let req = Request::builder()
                .method(method)
                .uri("/x")
                .header(header::ORIGIN, origin)
                .body(axum::body::Body::empty())
                .unwrap();
            async move { app.oneshot(req).await.unwrap().status() }
        };

        assert_eq!(
            send(Method::POST, "https://evil.example").await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            send(Method::DELETE, "https://evil.example").await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            send(Method::GET, "https://evil.example").await,
            StatusCode::OK
        );
        assert_eq!(
            send(Method::POST, "https://observ.ing").await,
            StatusCode::OK
        );
    }
}
