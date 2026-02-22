import { test as base, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";

const AUTH_FILE = resolve("playwright/.auth/user.json");
const USER_INFO_FILE = resolve("playwright/.auth/user-info.json");

let _testUser: Record<string, string> | null = null;

/**
 * Lazily loads user info written by auth.setup.ts.
 * Deferred because test modules are imported before the setup project runs.
 */
export function getTestUser() {
  if (!_testUser) {
    _testUser = JSON.parse(readFileSync(USER_INFO_FILE, "utf-8"));
  }
  return _testUser;
}

/**
 * Provides an authenticated page for tests.
 *
 * Creates a new browser context with the storageState saved by auth.setup.ts.
 * Requires BLUESKY_TEST_EMAIL and BLUESKY_TEST_PASSWORD to be set.
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: AUTH_FILE,
      geolocation: { latitude: 37.7749, longitude: -122.4194 },
      permissions: ["geolocation"],
    });
    const authPage = await context.newPage();
    await use(authPage);
    await context.close();
  },
});

export { expect } from "@playwright/test";
