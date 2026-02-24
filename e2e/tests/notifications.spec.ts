import { test as authTest, expect as authExpect } from "../fixtures/auth";

const mockNotifications = [
  {
    id: 3,
    actorDid: "did:plc:other1",
    kind: "comment",
    subjectUri: "at://did:plc:jh6n3ntljfhhtr4jbvrm3k5b/org.rwell.test.occurrence/seed1",
    referenceUri: "at://did:plc:other1/org.rwell.test.comment/1",
    read: false,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    actor: {
      did: "did:plc:other1",
      handle: "alice.bsky.social",
      displayName: "Alice",
    },
  },
  {
    id: 2,
    actorDid: "did:plc:other2",
    kind: "identification",
    subjectUri: "at://did:plc:jh6n3ntljfhhtr4jbvrm3k5b/org.rwell.test.occurrence/seed1",
    referenceUri: "at://did:plc:other2/org.rwell.test.identification/1",
    read: false,
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    actor: {
      did: "did:plc:other2",
      handle: "bob.bsky.social",
      displayName: "Bob",
    },
  },
  {
    id: 1,
    actorDid: "did:plc:other1",
    kind: "like",
    subjectUri: "at://did:plc:jh6n3ntljfhhtr4jbvrm3k5b/org.rwell.test.occurrence/seed1",
    referenceUri: "at://did:plc:other1/org.rwell.test.like/1",
    read: true,
    createdAt: new Date(Date.now() - 300_000).toISOString(),
    actor: {
      did: "did:plc:other1",
      handle: "alice.bsky.social",
      displayName: "Alice",
    },
  },
];

/** Set up route mocks for notification API endpoints */
async function mockNotificationRoutes(
  page: import("@playwright/test").Page,
  options?: {
    unreadCount?: number;
    notifications?: typeof mockNotifications;
  },
) {
  const notifs = options?.notifications ?? mockNotifications;
  let unread = options?.unreadCount ?? 2;

  // Must register more-specific routes first (Playwright matches in order)
  await page.route("**/api/notifications/unread-count", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: unread }),
    });
  });

  await page.route("**/api/notifications/read", (route) => {
    if (route.request().method() === "POST") {
      unread = 0;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    }
    return route.continue();
  });

  // Use a function matcher for the list endpoint so we match
  // /api/notifications?limit=20 without colliding with /unread-count or /read
  await page.route(
    (url) => url.pathname.endsWith("/api/notifications") && url.searchParams.has("limit"),
    (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ notifications: notifs, cursor: null }),
      });
    },
  );
}

authTest.describe("Notifications", () => {
  authTest("sidebar shows unread badge", async ({ authenticatedPage: page }) => {
    await mockNotificationRoutes(page);
    await page.goto("/");

    const badge = page.locator("nav .MuiBadge-badge");
    await authExpect(badge).toBeVisible({ timeout: 10_000 });
    await authExpect(badge).toHaveText("2");
  });

  authTest("sidebar hides badge when no unread", async ({ authenticatedPage: page }) => {
    await mockNotificationRoutes(page, { unreadCount: 0 });
    await page.goto("/");

    // MUI hides the badge element when count is 0
    const badge = page.locator("nav .MuiBadge-badge");
    await authExpect(badge).toBeHidden({ timeout: 10_000 });
  });

  authTest(
    "clicking notifications link navigates to /notifications",
    async ({ authenticatedPage: page }) => {
      await mockNotificationRoutes(page);
      await page.goto("/");

      // Nav items are links, not buttons
      await page.getByRole("link", { name: "Notifications" }).click();
      await authExpect(page).toHaveURL("/notifications");
    },
  );

  authTest(
    "notifications page shows all notification types",
    async ({ authenticatedPage: page }) => {
      await mockNotificationRoutes(page);
      await page.goto("/notifications");

      await authExpect(page.getByText("commented on your observation")).toBeVisible({
        timeout: 10_000,
      });
      await authExpect(page.getByText("identified your observation")).toBeVisible();
      await authExpect(page.getByText("liked your observation")).toBeVisible();
    },
  );

  authTest("notifications page shows actor handles", async ({ authenticatedPage: page }) => {
    await mockNotificationRoutes(page);
    await page.goto("/notifications");

    await authExpect(page.getByText("@alice.bsky.social").first()).toBeVisible({ timeout: 10_000 });
    await authExpect(page.getByText("@bob.bsky.social")).toBeVisible();
  });

  authTest(
    "unread notifications have highlighted background",
    async ({ authenticatedPage: page }) => {
      await mockNotificationRoutes(page);
      await page.goto("/notifications");

      await authExpect(page.getByText("commented on your observation")).toBeVisible({
        timeout: 10_000,
      });

      const items = page.locator("ul > li");
      // Third item (index 2) is read — should have transparent background
      const thirdItem = items.nth(2);
      await authExpect(thirdItem).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    },
  );

  authTest("mark all read button works", async ({ authenticatedPage: page }) => {
    await mockNotificationRoutes(page);
    await page.goto("/notifications");

    await authExpect(page.getByText("commented on your observation")).toBeVisible({
      timeout: 10_000,
    });

    const markAllBtn = page.getByRole("button", { name: "Mark all read" });
    await authExpect(markAllBtn).toBeVisible();
    await markAllBtn.click();

    // After marking all read, button should disappear (no more unread)
    await authExpect(markAllBtn).toBeHidden();
  });

  authTest(
    "clicking a notification navigates to the observation",
    async ({ authenticatedPage: page }) => {
      await mockNotificationRoutes(page);
      await page.goto("/notifications");

      await authExpect(page.getByText("commented on your observation")).toBeVisible({
        timeout: 10_000,
      });

      await page.getByText("commented on your observation").click();
      await authExpect(page).toHaveURL(/\/observation\//);
    },
  );

  authTest("empty state shows message", async ({ authenticatedPage: page }) => {
    await mockNotificationRoutes(page, {
      unreadCount: 0,
      notifications: [],
    });
    await page.goto("/notifications");

    await authExpect(page.getByText("No notifications yet")).toBeVisible({ timeout: 10_000 });
  });
});
