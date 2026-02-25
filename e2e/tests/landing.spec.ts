import { test, expect } from "@playwright/test";
import { test as authTest, expect as authExpect } from "../fixtures/auth";

test.describe("Landing Page", () => {
  test("unauthenticated user sees landing page at /", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Observe nature.")).toBeVisible();
    await expect(page.getByText("Own your data.")).toBeVisible();
  });

  test("landing page has Explore and Log in buttons", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Explore" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  });

  test("landing page shows feature cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Built on AT Protocol")).toBeVisible();
    await expect(page.getByText("Open Source")).toBeVisible();
    await expect(page.getByText("Data Portability")).toBeVisible();
    await expect(page.getByText("Contribute to Science")).toBeVisible();
  });

  test("Explore button navigates to /explore", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Explore" }).click();
    await expect(page).toHaveURL("/explore");
    // Should show feed content
    const cards = page.locator(".MuiCard-root");
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
  });

  test("Log in button opens login modal", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("landing page has footer links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Source Code" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Lexicons" })).toBeVisible();
  });
});

authTest.describe("Landing Page - Authenticated", () => {
  authTest(
    "authenticated user sees feed at /, not landing page",
    async ({ authenticatedPage: page }) => {
      await page.goto("/");
      // Should see the sidebar and feed, not the landing page
      await authExpect(page.getByRole("link", { name: "Home" }).first()).toBeVisible({
        timeout: 10000,
      });
      await authExpect(page.getByText("Observe nature.")).not.toBeVisible();
    },
  );
});
