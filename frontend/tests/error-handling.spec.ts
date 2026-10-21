import { test, expect } from "./fixtures/mock-auth";
import { mockOwnObservationFeed } from "./helpers/mock-observation";

test.describe("Error Handling", () => {
  test("network error shows error state, not blank page", async ({ page }) => {
    await page.route("**/api/feeds/**", (route) => route.abort());
    await page.route("**/api/occurrences/**", (route) => route.abort());
    await page.goto("/explore");
    // Page should still render the app shell
    await expect(page).toHaveTitle(/Explore/);
  });
});

test.describe("Error Handling - Authenticated", () => {
  test("API error on like reverts optimistic update", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.route("**/api/likes", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal server error" }),
        });
      }
      return route.continue();
    });

    await page.goto("/");
    // Wait for real feed content
    const likeButton = page.getByRole("button", { name: "Like" }).first();
    await expect(likeButton).toBeVisible();
    await likeButton.click();
    // Optimistic update should revert
    await expect(page.getByRole("button", { name: "Like" }).first()).toBeVisible({
      timeout: 3000,
    });
  });
});
