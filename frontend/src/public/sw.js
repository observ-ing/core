// App-shell service worker. Bump CACHE_VERSION to invalidate prior caches
// when changing this file's logic. Hashed assets under /assets/ are
// content-addressed, so this rarely needs bumping for normal releases.
const CACHE_VERSION = "v1";
const CACHE = `app-shell-${CACHE_VERSION}`;
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.add(SHELL_URL);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache backend traffic. Phase 4 will revisit selective caching.
  if (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/oauth") ||
    url.pathname.startsWith("/media")
  ) {
    return;
  }

  // Navigations: network-first so users always get fresh HTML when online,
  // fall back to the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(SHELL_URL, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          const cached = await cache.match(SHELL_URL);
          return cached ?? new Response("Offline", { status: 503 });
        }
      })(),
    );
    return;
  }

  // Hashed Vite assets are immutable — cache-first is safe and fast.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      })(),
    );
    return;
  }

  // Other same-origin GETs (icons, manifest, favicon): stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});
