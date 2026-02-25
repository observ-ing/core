import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
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
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-gl=angle", "--use-angle=swiftshader"],
        },
      },
    },
  ],
});
