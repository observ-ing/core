import { test as base, type Page } from "@playwright/test";
import { MOCK_TEST_USER } from "../helpers/test-users";

/**
 * The integration suite's `test`. Its `page` is logged out, as with plain
 * Playwright; `authenticatedPage` is signed in as MOCK_TEST_USER through a
 * mocked /oauth/me, so tests run without real Bluesky credentials. All data
 * API calls must be mocked by the individual tests.
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  // `contextOptions` lets a spec ask for another device, e.g. a phone's
  // viewport and touch, with `test.use({ contextOptions: ... })`.
  authenticatedPage: async ({ browser, contextOptions }, use) => {
    const context = await browser.newContext({
      ...contextOptions,
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
