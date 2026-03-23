import { test as base, type Page } from "@playwright/test";
import { MOCK_TEST_USER } from "../helpers/test-users";

export type { TestUser } from "./auth";

export function getTestUser() {
  return MOCK_TEST_USER;
}

/**
 * Provides an authenticated page for integration tests with mocked Bluesky auth.
 *
 * Intercepts /oauth/me to return a hardcoded test user so tests can run
 * without real Bluesky credentials. All data API calls must be mocked
 * by the individual tests.
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      geolocation: { latitude: 37.7749, longitude: -122.4194 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();
    await page.route("**/oauth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ user: MOCK_TEST_USER }),
      }),
    );
    await use(page);
    await context.close();
  },
});

export { expect } from "@playwright/test";
