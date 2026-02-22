import { test, expect } from "@playwright/test";

test.describe("Explore Filters", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/explore");
    // Wait for feed to load
    await page.waitForTimeout(1000);
  });

  // TC-FILTER-001: Filter panel visible
  test("filter panel is visible on explore tab", async ({ page }) => {
    await expect(page.getByText("Filters")).toBeVisible({ timeout: 10000 });
  });

  // TC-FILTER-002: Expand/collapse
  test("clicking expands and collapses filter panel", async ({ page }) => {
    const filtersHeader = page.getByText("Filters");
    await expect(filtersHeader).toBeVisible({ timeout: 10000 });

    // Click to expand
    await filtersHeader.click();
    await expect(page.getByLabel("Kingdom")).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel("Taxon")).toBeVisible();

    // Click to collapse
    await filtersHeader.click();
    await expect(page.getByLabel("Kingdom")).not.toBeVisible({ timeout: 5000 });
  });

  // TC-FILTER-003: Kingdom dropdown options
  test("kingdom dropdown shows all kingdom options", async ({ page }) => {
    await page.getByText("Filters").click();
    await expect(page.getByLabel("Kingdom")).toBeVisible({ timeout: 5000 });

    await page.getByLabel("Kingdom").click();
    // Check for kingdom options in the dropdown
    await expect(
      page.getByRole("option", { name: "All Kingdoms" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Animals" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Plants" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Fungi" }),
    ).toBeVisible();
  });

  // TC-FILTER-004: Taxon search autocomplete
  test("taxon search autocomplete shows suggestions", async ({ page }) => {
    await page.route("**/api/taxa/search*", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "1",
            scientificName: "Quercus alba",
            commonName: "White Oak",
            rank: "species",
            photoUrl: null,
          },
          {
            id: "2",
            scientificName: "Quercus rubra",
            commonName: "Red Oak",
            rank: "species",
            photoUrl: null,
          },
        ]),
      });
    });

    await page.getByText("Filters").click();
    const taxonInput = page.getByLabel("Taxon");
    await expect(taxonInput).toBeVisible({ timeout: 5000 });
    await taxonInput.fill("Quercus");

    await expect(
      page.locator(".MuiAutocomplete-popper"),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Quercus alba")).toBeVisible();
  });

  // TC-FILTER-005: Apply Filters dispatches filtered request
  test("Apply Filters button dispatches filtered feed request", async ({
    page,
  }) => {
    await page.route("**/api/taxa/search*", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.getByText("Filters").click();
    await expect(page.getByLabel("Kingdom")).toBeVisible({ timeout: 5000 });

    // Select a kingdom
    await page.getByLabel("Kingdom").click();
    await page.getByRole("option", { name: "Plants" }).click();

    // Click Apply Filters and verify the API request includes kingdom
    const feedRequest = page.waitForRequest(
      (req) =>
        req.url().includes("/api/feeds/explore") &&
        req.url().includes("kingdom=Plantae"),
    );
    await page.getByRole("button", { name: "Apply Filters" }).click();
    await feedRequest;
  });

  // TC-FILTER-006: Clear button resets filters
  test("Clear button resets all filters", async ({ page }) => {
    await page.getByText("Filters").click();
    await expect(page.getByLabel("Kingdom")).toBeVisible({ timeout: 5000 });

    // Select a kingdom first
    await page.getByLabel("Kingdom").click();
    await page.getByRole("option", { name: "Plants" }).click();

    // Clear should be enabled now
    const clearBtn = page.getByRole("button", { name: "Clear" });
    await expect(clearBtn).toBeEnabled();
    await clearBtn.click();

    // After clearing, the clear button should be disabled
    await expect(clearBtn).toBeDisabled();
  });

  // TC-FILTER-007: Active filter count badge
  test("active filter count badge updates", async ({ page }) => {
    await page.getByText("Filters").click();
    await expect(page.getByLabel("Kingdom")).toBeVisible({ timeout: 5000 });

    // No badge initially
    const filtersPanel = page.locator("text=Filters").locator("..");
    // Select kingdom to get 1 active filter
    await page.getByLabel("Kingdom").click();
    await page.getByRole("option", { name: "Plants" }).click();

    // Apply and check badge - need to click Apply to update the filter count
    await page.getByRole("button", { name: "Apply Filters" }).click();

    // After applying, the badge should show "1"
    // The chip with the count is next to "Filters" text
    await expect(page.locator(".MuiChip-root").filter({ hasText: "1" }).first()).toBeVisible({
      timeout: 5000,
    });
  });
});
