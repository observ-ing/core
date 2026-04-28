import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  expect: { timeout: 15_000 },
  use: {
    // Must use 127.0.0.1 (not localhost) because AT Protocol OAuth
    // redirects to http://127.0.0.1:3000/oauth/callback, and the
    // session_did cookie is set for the 127.0.0.1 domain.
    baseURL: "http://127.0.0.1:3000",
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Block the PWA service worker. Playwright's page.route() does not
    // intercept fetches made from a service worker, so an active SW would
    // route around our mock fixtures (e.g. /api/taxa/*) and hit the real
    // backend. App behavior under the SW should be tested separately.
    serviceWorkers: "block",
  },
  projects: [
    // Real e2e: signs in to Bluesky and runs a CRUD flow against the live PDS.
    // Requires BLUESKY_TEST_EMAIL, BLUESKY_TEST_PASSWORD, BLUESKY_TEST_HANDLE.
    {
      name: "e2e-setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "e2e",
      testMatch: /e2e\.spec\.ts/,
      dependencies: ["e2e-setup"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-gl=angle", "--use-angle=swiftshader"],
        },
        storageState: "playwright/.auth/user.json",
      },
    },
    // Integration: mocked Bluesky auth, no credentials required.
    {
      name: "integration",
      testMatch: /(?<!e2e)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-gl=angle", "--use-angle=swiftshader"],
        },
      },
    },
  ],
});
