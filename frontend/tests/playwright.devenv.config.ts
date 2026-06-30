import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the isolated dev-env run.
 *
 * Runs two project groups against the local dev-env stack that
 * scripts/e2e-devenv.ts boots (network + Rust services):
 *   - `devenv`: the same CRUD flow as the `e2e` project in playwright.config.ts,
 *     but authenticated against a local @atproto/dev-env PDS instead of
 *     bsky.social — so no test data touches the public network.
 *   - `integration`: the mocked suite (identical to playwright.config.ts). It
 *     stubs every backend call via page.route and only needs the SPA served at
 *     baseURL, which the dev-env appview provides. Kept here so CI gets full
 *     integration coverage from this single isolated run, with no live network.
 *
 * Needs no BLUESKY_* credentials; the orchestrator supplies DEVENV_* instead.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "devenv-setup",
      testMatch: /devenv-auth\.setup\.ts/,
    },
    {
      name: "devenv",
      testMatch: /e2e\.spec\.ts/,
      dependencies: ["devenv-setup"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-gl=angle", "--use-angle=swiftshader"],
        },
        storageState: "playwright/.auth/user.json",
      },
    },
    // Mocked suite — no backend dependency (page.route stubs everything), just
    // needs the SPA served at baseURL. Mirrors the `integration` project in
    // playwright.config.ts; no auth setup dependency (auth is mocked per-test).
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
