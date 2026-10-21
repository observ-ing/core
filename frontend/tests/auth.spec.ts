import { test, expect } from "./fixtures/mock-auth";
import { mockOwnObservationFeed } from "./helpers/mock-observation";
import { MOCK_TEST_USER } from "./helpers/test-users";
import { mockJson } from "./helpers/mock-api";

test.describe("Authentication - Logged Out", () => {
  test("clicking Log in opens login modal", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Log in" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    await expect(page.getByLabel("Your handle")).toBeVisible();
  });

  test("login modal shows handle input and Continue button", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Log in" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Your handle")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  test("login modal Continue button is disabled with empty handle", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Log in" }).first().click();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  test("login modal closes on Cancel", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Log in" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});

test.describe("Authentication - Logged In", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
  });

  test("logged in user sees their handle and logout button", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");
    // Open profile dropdown in TopBar
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByText(`@${MOCK_TEST_USER.handle}`).first()).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  });

  test("logged in user sees display name or handle in sidebar", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");
    // Sidebar shows displayName if set, otherwise handle
    await expect(page.getByText(MOCK_TEST_USER.displayName).first()).toBeVisible({ timeout: 5000 });
  });

  test("clicking Log out clears user session", async ({ authenticatedPage: page }) => {
    await mockJson(page, "**/oauth/logout", { success: true });
    let loggedOut = false;
    await page.unroute("**/oauth/me");
    await page.route("**/oauth/me", (route) =>
      route.fulfill({ json: { user: loggedOut ? null : MOCK_TEST_USER } }),
    );

    await page.goto("/");
    // Open profile dropdown and click Log out
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("button", { name: "Account menu" }).click();

    loggedOut = true;
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page.getByRole("button", { name: "Log in" }).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("logged in user sees Profile in top bar menu", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    // Open profile dropdown in TopBar
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Profile" })).toBeVisible();
  });
});
