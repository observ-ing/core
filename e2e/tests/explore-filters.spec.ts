import { test, expect, type Page } from "@playwright/test";

/**
 * MUI v7 Select doesn't link labels via aria-labelledby.
 * Find by traversing from the label to the parent FormControl.
 */
function muiSelect(page: Page, label: string) {
  return page
    .locator(".MuiFormControl-root", {
      has: page.locator("label", { hasText: label }),
    })
    .getByRole("combobox");
}

test.describe("Explore Filters", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/explore");
    // Wait for feed content to load instead of a fixed delay
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 15_000 });
  });

  // TC-FILTER-001: Filter panel visible
  test("filter panel is visible on explore tab", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Filters" })).toBeVisible();
  });

  // TC-FILTER-002: Expand/collapse
  test("clicking expands and collapses filter panel", async ({ page }) => {
    const filtersHeader = page.getByRole("heading", { name: "Filters" });
    await expect(filtersHeader).toBeVisible();

    // Click to expand
    await filtersHeader.click();
    await expect(muiSelect(page, "Kingdom")).toBeVisible();
    await expect(page.getByLabel("Taxon")).toBeVisible();

    // Click to collapse
    await filtersHeader.click();
    await expect(muiSelect(page, "Kingdom")).not.toBeVisible();
  });

  // TC-FILTER-003: Kingdom dropdown options
  test("kingdom dropdown shows all kingdom options", async ({ page }) => {
    await page.getByRole("heading", { name: "Filters" }).click();
    const kingdomSelect = muiSelect(page, "Kingdom");
    await expect(kingdomSelect).toBeVisible();

    await kingdomSelect.click();
    await expect(page.getByRole("option", { name: "All Kingdoms" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Animals" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Plants" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Fungi" })).toBeVisible();
  });

  // TC-FILTER-004: Taxon search autocomplete shows suggestions
  test("taxon search autocomplete shows suggestions", async ({ page }) => {
    await page.getByRole("heading", { name: "Filters" }).click();
    const taxonInput = page.getByLabel("Taxon");
    await expect(taxonInput).toBeVisible();
    await taxonInput.fill("Quercus");

    await expect(page.locator(".MuiAutocomplete-popper")).toBeVisible();
  });

  // TC-FILTER-005: Apply Filters dispatches filtered request
  test("Apply Filters button dispatches filtered feed request", async ({ page }) => {
    await page.getByRole("heading", { name: "Filters" }).click();
    const kingdomSelect = muiSelect(page, "Kingdom");
    await expect(kingdomSelect).toBeVisible();

    // Select a kingdom
    await kingdomSelect.click();
    await page.getByRole("option", { name: "Plants" }).click();

    // Click Apply Filters and verify the API request includes kingdom
    const feedRequest = page.waitForRequest(
      (req) => req.url().includes("/api/feeds/explore") && req.url().includes("kingdom=Plantae"),
    );
    await page.getByRole("button", { name: "Apply Filters" }).click();
    await feedRequest;
  });

  // TC-FILTER-006: Clear button resets filters
  test("Clear button resets all filters", async ({ page }) => {
    await page.getByRole("heading", { name: "Filters" }).click();
    const kingdomSelect = muiSelect(page, "Kingdom");
    await expect(kingdomSelect).toBeVisible();

    // Select a kingdom first
    await kingdomSelect.click();
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
    await page.getByRole("heading", { name: "Filters" }).click();
    const kingdomSelect = muiSelect(page, "Kingdom");
    await expect(kingdomSelect).toBeVisible();

    // Select kingdom to get 1 active filter
    await kingdomSelect.click();
    await page.getByRole("option", { name: "Plants" }).click();

    // Apply and check badge
    await page.getByRole("button", { name: "Apply Filters" }).click();

    // After applying, the badge should show "1"
    await expect(page.locator(".MuiChip-root").filter({ hasText: "1" }).first()).toBeVisible();
  });
});
