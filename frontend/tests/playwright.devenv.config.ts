import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the isolated dev-env run.
 *
 * Runs the CRUD e2e (e2e.spec.ts) against the local dev-env stack that
 * scripts/e2e-devenv.ts boots (network + Rust services), authenticated against
 * a local @atproto/dev-env PDS — so no test data touches the public network.
 * This is the only place the real e2e runs. The mocked `integration` suite
 * needs no backend and runs from playwright.config.ts instead.
 *
 * Needs no real-account credentials; the orchestrator supplies DEVENV_*.
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
  ],
});
