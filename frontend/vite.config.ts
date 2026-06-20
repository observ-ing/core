import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import path from "path";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Resolve where dependencies actually live. A hardcoded `../node_modules` is
// wrong inside a git worktree without its own `node_modules`: deps resolve
// (hoisted) to the main checkout's node_modules, so the self-hosted @fontsource
// woff2 files end up outside `fs.allow` and 403 — brand fonts then fall back to
// system sans. Anchoring on a real dependency follows the same upward lookup
// Node/Vite use, so this points at the node_modules that is genuinely in play.
const resolvedNodeModules = path.resolve(
  path.dirname(require.resolve("@fontsource/dm-sans/package.json")),
  "../..",
);

// Single knob for the dev-server port (defaults to Vite's usual 5173). A
// multi-worktree setup can relocate the whole dev server with one env var
// (e.g. VITE_PORT=5273) and the HMR client follows along instead of flooding
// the console reconnecting to a stale 5173. See issue #659.
const devPort = Number(process.env.VITE_PORT) || 5173;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // `prompt` so the app can surface "new version available" via
      // `useRegisterSW` and let the user click to reload, instead of
      // relying on the user to refresh blindly. See UpdatePrompt.tsx.
      registerType: "prompt",
      manifest: false,
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/oauth/, /^\/media/, /^\/admin/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff2}"],
        cleanupOutdatedCaches: true,
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
    port: devPort,
    // Pin the port so the resolved dev-server port can't silently drift off
    // `devPort` (Vite would otherwise auto-increment past a busy port and
    // leave `hmr.clientPort` pointing at the wrong server).
    strictPort: true,
    fs: {
      // Allow serving dependency assets that live outside the `src` root — e.g.
      // the self-hosted @fontsource woff2 files (otherwise they 403 and the
      // brand fonts fall back to system sans). `resolvedNodeModules` finds the
      // node_modules actually in use (see its definition for the worktree case).
      allow: [path.resolve(__dirname, "../lexicons"), resolvedNodeModules, "."],
    },
    hmr: {
      // When accessed via the Rust proxy on port 3000, the HMR WebSocket must
      // still connect directly to Vite so it isn't routed through the proxy.
      // Follows `devPort` rather than a hardcoded 5173 so other-port worktrees
      // don't flood the console reconnecting to the wrong server.
      host: "localhost",
      clientPort: devPort,
    },
    proxy: {
      "/api": "http://localhost:3000",
      "/oauth": "http://localhost:3000",
      "/media": "http://localhost:3000",
    },
  },
});
