import { test, expect } from "@playwright/test";
import { navigateToMockedDetail } from "./helpers/mock-observation";

test.describe("Observation Detail - Display", () => {
  test("renders species name or unidentified label", async ({ page }) => {
    await navigateToMockedDetail(page);
    // Every observation shows either a species name or "Unidentified"
    const hasSpecies = await page
      .locator("a[href*='/taxon/']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasUnidentified = await page
      .getByText("Unidentified")
      .isVisible()
      .catch(() => false);
    expect(hasSpecies || hasUnidentified).toBeTruthy();
  });

  test("shows observation date and coordinates", async ({ page }) => {
    await navigateToMockedDetail(page);
    await expect(page.getByText("Observed")).toBeVisible();
    await expect(page.getByText("Coordinates")).toBeVisible();
  });

  test("shows observer info", async ({ page }) => {
    await navigateToMockedDetail(page);
    // Observer section has an avatar
    await expect(page.locator(".MuiAvatar-root").first()).toBeVisible();
  });

  test("shows identification history section", async ({ page }) => {
    await navigateToMockedDetail(page);
    // The section header renders regardless of whether any IDs exist.
    await expect(page.getByRole("heading", { name: "Identification History" })).toBeVisible();
  });

  test("shows discussion section", async ({ page }) => {
    await navigateToMockedDetail(page);
    await expect(page.getByRole("heading", { name: "Discussion" })).toBeVisible();
  });

  test("like button visible on detail page", async ({ page }) => {
    await navigateToMockedDetail(page);
    await expect(page.getByRole("button", { name: "Like" })).toBeVisible();
  });

  test("logged-out user sees login prompts for ID and comments", async ({ page }) => {
    await navigateToMockedDetail(page);
    await expect(page.getByText("Log in to add an identification")).toBeVisible();
    await expect(page.getByText("Log in to add a comment")).toBeVisible();
  });
});
