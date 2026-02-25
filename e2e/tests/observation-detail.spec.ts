import { test, expect } from "@playwright/test";

/** Navigate from the feed to the first observation's detail page. */
async function navigateToDetail(page: any) {
  await page.goto("/explore");
  const card = page.locator(".MuiCard-root .MuiCardActionArea-root").first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();
  await expect(page).toHaveURL(/\/observation\/.+\/.+/);
  // Wait for detail page content to render
  await expect(page.getByText("Observed")).toBeVisible({ timeout: 15000 });
}

test.describe("Observation Detail - Display", () => {
  // TC-DETAIL-001: Species or unidentified label
  test("renders species name or unidentified label", async ({ page }) => {
    await navigateToDetail(page);
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

  // TC-DETAIL-002: Observation date and coordinates
  test("shows observation date and coordinates", async ({ page }) => {
    await navigateToDetail(page);
    await expect(page.getByText("Observed")).toBeVisible();
    await expect(page.getByText("Coordinates")).toBeVisible();
  });

  // TC-DETAIL-003: Observer info
  test("shows observer info", async ({ page }) => {
    await navigateToDetail(page);
    // Observer section has an avatar
    await expect(page.locator(".MuiAvatar-root").first()).toBeVisible();
  });

  // TC-DETAIL-004: Identification history section
  test("shows identification history section", async ({ page }) => {
    await navigateToDetail(page);
    // Shows either the heading (when IDs exist) or the empty-state prompt
    const heading = page.getByText("Identification History");
    const emptyState = page.getByText("No identifications yet");
    await expect(heading.or(emptyState)).toBeVisible();
  });

  // TC-DETAIL-005: Discussion section
  test("shows discussion section", async ({ page }) => {
    await navigateToDetail(page);
    await expect(page.getByRole("heading", { name: "Discussion" })).toBeVisible();
  });

  // TC-DETAIL-006: Species interactions section
  test("shows species interactions section", async ({ page }) => {
    await navigateToDetail(page);
    await expect(page.getByText("Species Interactions")).toBeVisible();
  });

  // TC-DETAIL-007: Like button visible
  test("like button visible on detail page", async ({ page }) => {
    await navigateToDetail(page);
    await expect(page.getByRole("button", { name: "Like" })).toBeVisible();
  });

  // TC-DETAIL-008: Logged-out user sees login prompts
  test("logged-out user sees login prompts for ID and comments", async ({ page }) => {
    await navigateToDetail(page);
    await expect(page.getByText("Log in to add an identification")).toBeVisible();
    await expect(page.getByText("Log in to add a comment")).toBeVisible();
    await expect(page.getByText("Log in to add interactions")).toBeVisible();
  });
});
