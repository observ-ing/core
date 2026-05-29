# axum-static-spa

Cache-control and security-header [axum](https://docs.rs/axum) middleware for
serving a single-page app built with content-addressed (hashed) assets.

- **`cache_control`** — `no-cache` on entry points (`index.html`, the service
  worker, the web manifest) so a deploy is picked up on the next load instead
  of taking two reloads; a one-year `immutable` directive on hashed assets.
  Paths are configurable; `CacheControl::vite()` ships sensible defaults for a
  Vite + Workbox PWA.
- **`security_headers`** — `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, and optional HSTS.

```rust,ignore
use std::sync::Arc;
use axum::middleware::{from_fn_with_state, map_response};
use axum_static_spa::{cache_control, security_headers, CacheControl, SecurityHeaders};

let sec = SecurityHeaders::new().hsts(is_production);
let app = router
    .layer(map_response(move |res| security_headers(res, sec)))
    .layer(from_fn_with_state(Arc::new(CacheControl::vite()), cache_control));
```

Depends only on `axum`.
