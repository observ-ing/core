import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the isolated dev-env e2e run.
 *
 * Same CRUD flow as the `e2e` project in playwright.config.ts, but authenticates
 * against a local @atproto/dev-env PDS instead of bsky.social — so no test data
 * touches the public network. Driven by scripts/e2e-devenv.ts, which boots the
 * network, points the Rust services at it, then runs this config.
 *
 * Needs no BLUESKY_* credentials; the orchestrator supplies DEVENV_* instead.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
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
  ],
});
