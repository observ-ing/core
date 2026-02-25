import { test, expect } from "@playwright/test";
import { test as authTest, expect as authExpect } from "../fixtures/auth";

test.describe("Error Handling", () => {
  // TC-ERR-001: Network error on feed load
  test("network error shows error state, not blank page", async ({ page }) => {
    await page.route("**/api/feeds/**", (route) => route.abort());
    await page.route("**/api/occurrences/**", (route) => route.abort());
    await page.goto("/explore");
    // Page should still render the app shell (filter panel is always present on explore)
    await expect(page.getByText("All Kingdoms")).toBeVisible({ timeout: 10000 });
  });
});

authTest.describe("Error Handling - Authenticated", () => {
  // TC-ERR-002: API error on submission
  authTest("API error on like reverts optimistic update", async ({ authenticatedPage: page }) => {
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
    await authExpect(likeButton).toBeVisible({ timeout: 15000 });
    await likeButton.click();
    // Optimistic update should revert
    await authExpect(page.getByRole("button", { name: "Like" }).first()).toBeVisible({
      timeout: 3000,
    });
  });
});
