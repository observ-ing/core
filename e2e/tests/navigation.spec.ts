import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  // TC-NAV-001: Home page load
  test("home page loads with feed and header", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Observ.ing" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Home" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Explore" }).first()).toBeVisible();
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
    await page.goto("/");
    const feedCard = page.locator(".MuiCard-root").first();
    await expect(feedCard).toBeVisible({ timeout: 10000 });
    await feedCard.locator(".MuiCardActionArea-root").click();
    await expect(page).toHaveURL(/\/observation\//);
  });
});
