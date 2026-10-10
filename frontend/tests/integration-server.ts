/**
 * Web server for the mocked `integration` Playwright project, started by
 * playwright.config.ts's `webServer`.
 *
 * Builds the SPA and serves it with no backend behind it: every route the
 * appview owns answers 404, so a call a spec doesn't mock with page.route fails
 * the same way every run instead of reaching whatever AppView happens to be on
 * the port. That keeps the suite hermetic and fully parallel, with no Rust
 * stack or database needed.
 *
 * Builds into dist/integration, not dist/public: the appview serves dist/public
 * whenever it exists, so building there would quietly switch a local dev stack
 * from proxying Vite to serving this soon-stale bundle.
 */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const OUT_DIR = join(ROOT, "dist/integration");
const PORT = Number(process.env.INTEGRATION_PORT) || 4173;

// The appview's routes, mirroring the PWA's navigateFallbackDenylist in
// vite.config.ts. Everything else is the SPA.
const BACKEND_ROUTE = /^\/(api|oauth|media|admin)(\/|$)/;

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

await build({
  configFile: join(ROOT, "frontend/vite.config.ts"),
  build: { outDir: OUT_DIR },
  // The bundle's chunk-size warning is noise in test output.
  logLevel: "error",
});

const indexHtml = await readFile(join(OUT_DIR, "index.html"));

/** The built file `pathname` names, or null if it's outside OUT_DIR or missing. */
async function readBuilt(pathname: string): Promise<Buffer | null> {
  try {
    const file = join(OUT_DIR, decodeURIComponent(pathname));
    if (!file.startsWith(OUT_DIR + sep)) return null;
    return await readFile(file);
  } catch {
    // Malformed escapes, missing files and directories all fall back to the SPA.
    return null;
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");

  if (BACKEND_ROUTE.test(pathname)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `not mocked: ${req.method} ${pathname}` }));
    return;
  }

  // Like the appview's ServeDir fallback: real files as-is, anything else is
  // a client-side route.
  const body = await readBuilt(pathname);
  if (body) {
    const type = CONTENT_TYPES[extname(pathname)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(body);
  } else {
    res.writeHead(200, { "content-type": CONTENT_TYPES[".html"] });
    res.end(indexHtml);
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[integration-server] serving ${OUT_DIR} on http://127.0.0.1:${PORT}`);
});
