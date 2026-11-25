import { test, expect } from "./fixtures/mock-auth";
import { navigateToMockedDetail, mockOwnObservationFeed } from "./helpers/mock-observation";
import { mockJson } from "./helpers/mock-api";

test.describe("Likes - Logged Out", () => {
  test("detail page shows a heart icon", async ({ page }) => {
    await navigateToMockedDetail(page);
    const likeButton = page.getByRole("button", { name: "Like" }).first();
    await expect(likeButton).toBeVisible();
  });

  test("like button is disabled when not logged in", async ({ page }) => {
    await navigateToMockedDetail(page);
    const likeButton = page.getByRole("button", { name: "Like" }).first();
    await expect(likeButton).toBeVisible();
    await expect(likeButton).toBeDisabled();
  });
});

test.describe("Likes - Logged In", () => {
  test("clicking like button fills the heart", async ({ authenticatedPage: page }) => {
    // Mock the like API
    await mockJson(page, "**/api/likes", { success: true }, { method: "POST" });

    await mockOwnObservationFeed(page);
    await page.goto("/");
    // Wait for real feed cards (not skeletons) by waiting for Like button
    const likeButton = page.getByRole("button", { name: "Like" }).first();
    await expect(likeButton).toBeVisible();
    await expect(likeButton).toBeEnabled();
    await likeButton.click();
    // After clicking, button should change to "Unlike"
    await expect(page.getByRole("button", { name: "Unlike" }).first()).toBeVisible();
  });

  test("clicking unlike button unfills the heart", async ({ authenticatedPage: page }) => {
    // Mock like and unlike APIs
    await mockJson(page, "**/api/likes", { success: true });

    await mockOwnObservationFeed(page);
    await page.goto("/");
    const likeButton = page.getByRole("button", { name: "Like" }).first();
    await expect(likeButton).toBeVisible();
    await likeButton.click();
    // Now unlike
    const unlikeButton = page.getByRole("button", { name: "Unlike" }).first();
    await expect(unlikeButton).toBeVisible();
    await unlikeButton.click();
    // Should revert to Like
    await expect(page.getByRole("button", { name: "Like" }).first()).toBeVisible();
  });

  test("clicking like does not navigate away from feed", async ({ authenticatedPage: page }) => {
    await mockJson(page, "**/api/likes", { success: true }, { method: "POST" });

    await mockOwnObservationFeed(page);
    await page.goto("/");
    const likeButton = page.getByRole("button", { name: "Like" }).first();
    await expect(likeButton).toBeVisible();
    await likeButton.click();
    // Should still be on the home page
    await expect(page).toHaveURL("/");
  });
});
