import { defineConfig, devices } from "@playwright/test";

// The mocked suite brings its own server (integration-server.ts) on a port of
// its own, so it doesn't need — or collide with — a running dev stack on :3000.
const PORT = Number(process.env.INTEGRATION_PORT) || 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Every backend call is mocked or answered 404 by integration-server.ts, so
  // tests share no state. CI stays at 2: on GitHub's 4-vCPU runners, 4 workers
  // (each rendering via SwiftShader) made every test ~2.4x slower for only a
  // 1.4x wall-clock gain, and pushed timing-sensitive specs past their timeouts.
  workers: process.env.CI ? 2 : undefined,
  reporter: "html",
  expect: { timeout: 15_000 },
  webServer: {
    // Builds the SPA, then serves it with every backend route answering 404.
    command: "npx tsx integration-server.ts",
    url: BASE_URL,
    env: { INTEGRATION_PORT: String(PORT) },
    // Never reuse: whatever already holds the port isn't this build.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: BASE_URL,
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
    // The real CRUD e2e (e2e.spec.ts) runs only in playwright.devenv.config.ts,
    // against a throwaway local ATProto network: `npm run test:e2e:devenv`.
    // Integration: mocked Bluesky auth, no credentials or backend required.
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
