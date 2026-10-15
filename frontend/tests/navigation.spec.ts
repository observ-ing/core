import { test, expect } from "@playwright/test";
import { mockOwnObservationFeed } from "./helpers/mock-observation";

test.describe("Navigation", () => {
  // TC-NAV-001: Home page load — unauthenticated users see landing page
  test("home page loads with landing page for unauthenticated users", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Observe nature.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Explore" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  });

  test("the app is sized to the space a mobile address bar leaves", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Observe nature.")).toBeVisible();
    const height = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
      const root = rules.find(
        (rule): rule is CSSStyleRule =>
          rule instanceof CSSStyleRule && rule.selectorText === "#root",
      );
      return root?.style.height;
    });
    // `dvh` follows the address bar as it shows and hides; `vh` would put the
    // bottom of the app under it.
    expect(height).toBe("100dvh");
  });

  // TC-NAV-002: 404 page
  test("invalid route shows 404 page", async ({ page }) => {
    await page.goto("/invalid-route-xyz");
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go home" })).toBeVisible();
  });

  test("404 Go home link navigates to /", async ({ page }) => {
    await page.goto("/invalid-route-xyz");
    await page.getByRole("link", { name: "Go home" }).click();
    await expect(page).toHaveURL("/");
  });

  // TC-NAV-003: Observation detail page
  test("clicking a feed item navigates to observation detail", async ({ page }) => {
    await mockOwnObservationFeed(page);
    await page.goto("/explore");
    const feedCard = page.locator(".MuiCard-root").first();
    await expect(feedCard).toBeVisible({ timeout: 10000 });
    await feedCard.locator(".MuiCardActionArea-root").click();
    await expect(page).toHaveURL(/\/observation\//);
  });
});
