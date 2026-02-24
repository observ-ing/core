import { test, expect } from "@playwright/test";
import { test as authTest, expect as authExpect } from "../fixtures/auth";

test.describe("Likes - Logged Out", () => {
  // TC-LIKE-001: Like button visible on feed items
  test("feed items show a heart icon", async ({ page }) => {
    await page.goto("/");
    // Wait for actual feed content (not skeleton cards) by waiting for a Like button
    const likeButton = page.getByRole("button", { name: "Like" }).first();
    await expect(likeButton).toBeVisible({ timeout: 15000 });
  });

  // TC-LIKE-002: Like button disabled when logged out
  test("like button is disabled when not logged in", async ({ page }) => {
    await page.goto("/");
    const likeButton = page.getByRole("button", { name: "Like" }).first();
    await expect(likeButton).toBeVisible({ timeout: 15000 });
    await expect(likeButton).toBeDisabled();
  });
});

authTest.describe("Likes - Logged In", () => {
  // TC-LIKE-003: Like an observation from feed
  authTest("clicking like button fills the heart", async ({ authenticatedPage: page }) => {
    // Mock the like API
    await page.route("**/api/likes", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      }
      return route.continue();
    });

    await page.goto("/");
    // Wait for real feed cards (not skeletons) by waiting for Like button
    const likeButton = page.getByRole("button", { name: "Like" }).first();
    await authExpect(likeButton).toBeVisible({ timeout: 15000 });
    await authExpect(likeButton).toBeEnabled();
    await likeButton.click();
    // After clicking, button should change to "Unlike"
    await authExpect(page.getByRole("button", { name: "Unlike" }).first()).toBeVisible();
  });

  // TC-LIKE-004: Unlike an observation from feed
  authTest("clicking unlike button unfills the heart", async ({ authenticatedPage: page }) => {
    // Mock like and unlike APIs
    await page.route("**/api/likes", (route) => {
      if (route.request().method() === "POST" || route.request().method() === "DELETE") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      }
      return route.continue();
    });

    await page.goto("/");
    const likeButton = page.getByRole("button", { name: "Like" }).first();
    await authExpect(likeButton).toBeVisible({ timeout: 15000 });
    await likeButton.click();
    // Now unlike
    const unlikeButton = page.getByRole("button", { name: "Unlike" }).first();
    await authExpect(unlikeButton).toBeVisible();
    await unlikeButton.click();
    // Should revert to Like
    await authExpect(page.getByRole("button", { name: "Like" }).first()).toBeVisible();
  });

  // TC-LIKE-009: Like button click does not navigate
  authTest(
    "clicking like does not navigate away from feed",
    async ({ authenticatedPage: page }) => {
      await page.route("**/api/likes", (route) => {
        if (route.request().method() === "POST") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ success: true }),
          });
        }
        return route.continue();
      });

      await page.goto("/");
      const likeButton = page.getByRole("button", { name: "Like" }).first();
      await authExpect(likeButton).toBeVisible({ timeout: 15000 });
      await likeButton.click();
      // Should still be on the home page
      await authExpect(page).toHaveURL("/");
    },
  );
});
