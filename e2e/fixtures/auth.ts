import { test as base, type Page } from "@playwright/test";

export const MOCK_USER = {
  did: "did:plc:test123",
  handle: "testuser.bsky.social",
  displayName: "Test User",
  avatar: "",
};

/**
 * Sets up a page that appears authenticated to the frontend.
 *
 * Strategy:
 * - By default, intercepts GET /oauth/me to return a mock user.
 *   The frontend Redux auth slice trusts this response, so the UI
 *   renders as if logged in (FAB visible, like buttons enabled, etc.).
 * - If TEST_SESSION_COOKIE env var is set, uses a real session cookie
 *   instead of mocking, enabling full integration testing.
 */
async function setupAuth(page: Page, context: any) {
  const realCookie = process.env.TEST_SESSION_COOKIE;
  if (realCookie) {
    await context.addCookies([
      {
        name: "session_did",
        value: realCookie,
        domain: "localhost",
        path: "/",
      },
    ]);
  } else {
    await page.route("**/oauth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ user: MOCK_USER }),
      }),
    );
    // The mock session isn't valid on the backend, so /api/feeds/home
    // will fail. Redirect home feed requests to the explore feed instead.
    await page.route("**/api/feeds/home*", (route) => {
      const url = route.request().url().replace("/api/feeds/home", "/api/feeds/explore");
      return route.continue({ url });
    });
  }
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page, context }, use) => {
    await setupAuth(page, context);
    await use(page);
  },
});

export { expect } from "@playwright/test";
