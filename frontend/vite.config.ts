import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import path from "path";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/oauth/, /^\/media/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        cleanupOutdatedCaches: true,
        // Bumped from default 2 MiB so the current bundle precaches.
        // Code-splitting is the proper fix; tracked separately.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Only cache routes whose responses are independent of the viewer.
        // /api/taxa/{...}/occurrences and other enrichment-touched routes
        // embed `viewer_has_liked` and must NOT be cached without per-user
        // keying.
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin, request }) =>
              sameOrigin &&
              request.method === "GET" &&
              url.pathname.startsWith("/api/taxa/") &&
              !url.pathname.endsWith("/occurrences"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "taxa",
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin, request }) =>
              sameOrigin &&
              request.method === "GET" &&
              /^\/media\/(blob|thumb)\/[^/]+\/[^/]+$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "media",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  root: path.resolve(__dirname, "src"),
  publicDir: path.resolve(__dirname, "src/public"),
  resolve: {
    alias: {
      "@lexicons": path.resolve(__dirname, "../lexicons"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: path.resolve(__dirname, "../dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "../lexicons"), "."],
    },
    hmr: {
      // When accessed via the Rust proxy on port 3000, HMR WebSocket must still
      // connect directly to Vite so it isn't routed through the proxy
      host: 'localhost',
      clientPort: 5173,
    },
    proxy: {
      "/api": "http://localhost:3000",
      "/oauth": "http://localhost:3000",
      "/media": "http://localhost:3000",
    },
  },
});
