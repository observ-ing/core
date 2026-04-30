use axum::extract::Request;
use axum::http::{header, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;

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
