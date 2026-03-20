use axum::http::HeaderValue;
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
