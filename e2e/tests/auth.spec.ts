import { test, expect } from "@playwright/test";
import {
  test as authTest,
  expect as authExpect,
  MOCK_USER,
} from "../fixtures/auth";

test.describe("Authentication - Logged Out", () => {
  // TC-AUTH-001: Login flow - modal opens
  test("clicking Log in opens login modal", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Log in" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Log in" }),
    ).toBeVisible();
    await expect(page.getByLabel("Your handle")).toBeVisible();
  });

  test("login modal shows handle input and Continue button", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Log in" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Your handle")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Continue" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Cancel" }),
    ).toBeVisible();
  });

  test("login modal Continue button is disabled with empty handle", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Log in" }).first().click();
    await expect(
      page.getByRole("button", { name: "Continue" }),
    ).toBeDisabled();
  });

  test("login modal closes on Cancel", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Log in" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});

authTest.describe("Authentication - Logged In", () => {
  // TC-AUTH-002: Logout button visible
  authTest(
    "logged in user sees their handle and logout button",
    async ({ authenticatedPage: page }) => {
      await page.goto("/");
      await authExpect(
        page.getByText(`@${MOCK_USER.handle}`).first(),
      ).toBeVisible({ timeout: 5000 });
      await authExpect(
        page.getByRole("button", { name: "Log out" }).first(),
      ).toBeVisible();
    },
  );

  // TC-AUTH-003: User display
  authTest(
    "logged in user sees display name in sidebar",
    async ({ authenticatedPage: page }) => {
      await page.goto("/");
      await authExpect(
        page.getByText(MOCK_USER.displayName).first(),
      ).toBeVisible({ timeout: 5000 });
    },
  );

  // TC-AUTH-002: Logout flow
  authTest("clicking Log out clears user session", async ({
    authenticatedPage: page,
  }) => {
    await page.route("**/oauth/logout", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      }),
    );
    let loggedOut = false;
    await page.unroute("**/oauth/me");
    await page.route("**/oauth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: loggedOut ? null : MOCK_USER,
        }),
      });
    });

    await page.goto("/");
    await authExpect(
      page.getByText(`@${MOCK_USER.handle}`).first(),
    ).toBeVisible({ timeout: 5000 });

    loggedOut = true;
    await page.getByRole("button", { name: "Log out" }).first().click();
    await authExpect(
      page.getByRole("button", { name: "Log in" }).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  authTest(
    "logged in user sees Profile in sidebar navigation",
    async ({ authenticatedPage: page }) => {
      await page.goto("/");
      await authExpect(
        page.getByRole("link", { name: "Profile" }).first(),
      ).toBeVisible({ timeout: 5000 });
    },
  );
});
