import { test, expect } from "@playwright/test";

// These tests need the SW to actually run, so they override the global
// `serviceWorkers: "block"` from playwright.config.ts.
test.use({ serviceWorkers: "allow" });

test.describe("PWA service worker", () => {
  test("registers and becomes active after first page load", async ({ context, page }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);

    const workers = context.serviceWorkers();
    expect(workers.length).toBe(1);
    expect(workers[0].url()).toContain("/sw.js");

    const controllerUrl = await page.evaluate(
      () => navigator.serviceWorker.controller?.scriptURL ?? null,
    );
    expect(controllerUrl).toContain("/sw.js");
  });

  test("generated sw.js contains the configured runtime caching rules", async ({ page }) => {
    // Catches a regression where vite.config.ts changes silently drop
    // the runtimeCaching config without anyone noticing.
    const response = await page.request.get("/sw.js");
    const body = await response.text();
    expect(body).toContain("/api/taxa/");
    expect(body).toContain("StaleWhileRevalidate");
    expect(body).toContain("CacheFirst");
    expect(body).toMatch(/cacheName:\s*"(taxa|media)"/);
  });

  test("workbox precache is populated with the app shell", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);

    const cacheKeys = await page.evaluate(() => caches.keys());
    const precacheName = cacheKeys.find((k) => k.startsWith("workbox-precache"));
    expect(precacheName).toBeTruthy();

    const hasManifest = await page.evaluate(async (name) => {
      const cache = await caches.open(name);
      const match = await cache.match("/manifest.webmanifest");
      return Boolean(match);
    }, precacheName!);
    expect(hasManifest).toBe(true);
  });

  test("app shell loads when the network is offline", async ({ context, page }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Wait until the SW is controlling this client so the next navigation
    // is served by it.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    await context.setOffline(true);
    await page.reload();

    await expect(page).toHaveTitle("Observ.ing");
    const rootHasContent = await page.evaluate(
      () => (document.getElementById("root")?.children.length ?? 0) > 0,
    );
    expect(rootHasContent).toBe(true);
  });

  test("/unregister.html clears the registration and caches", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);

    await page.goto("/unregister.html");
    await expect(page.locator("#status")).toContainText(/Unregistered \d+ service worker/);

    const remaining = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      const cacheKeys = await caches.keys();
      return { regs: regs.length, caches: cacheKeys.length };
    });
    expect(remaining.regs).toBe(0);
    expect(remaining.caches).toBe(0);
  });
});
