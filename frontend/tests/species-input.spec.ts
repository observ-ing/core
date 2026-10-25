import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/mock-auth";
import { openUploadModal, gotoUploadStep, searchTaxa } from "./helpers/navigation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";
import { mockOwnObservationFeed } from "./helpers/mock-observation";

const taxonInput = (page: Page) => page.getByLabel(/Taxon/i);

test.describe("Species Input", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await mockTaxaSearchRoute(page);
    await page.goto("/");
    await openUploadModal(page);
    // Taxon input lives in the Identify step; reveal it for every test here.
    await gotoUploadStep(page, "Identify");
  });

  test("typing a common name shows scientific name in suggestions", async ({
    authenticatedPage: page,
  }) => {
    await searchTaxa(taxonInput(page), "california poppy");
    const option = page.locator(".MuiAutocomplete-option").first();
    await expect(option).toBeVisible();
  });

  test("typing a scientific name shows matching species", async ({ authenticatedPage: page }) => {
    await searchTaxa(taxonInput(page), "Quercus");
    const option = page.locator(".MuiAutocomplete-option").first();
    await expect(option).toBeVisible();
    await expect(page.locator(".MuiAutocomplete-popper")).toContainText(/quercus/i);
  });

  test("lowercase scientific name still finds results", async ({ authenticatedPage: page }) => {
    await searchTaxa(taxonInput(page), "quercus alba");
    const option = page.locator(".MuiAutocomplete-option").first();
    await expect(option).toBeVisible();
  });

  test("selecting an autocomplete suggestion populates the input", async ({
    authenticatedPage: page,
  }) => {
    const speciesInput = taxonInput(page);
    await searchTaxa(speciesInput, "quercus");
    const option = page.locator(".MuiAutocomplete-option").first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(speciesInput).not.toHaveValue("");
    await expect(page.locator(".MuiAutocomplete-popper")).not.toBeVisible();
  });

  test("selecting an autocomplete suggestion hides the kingdom select", async ({
    authenticatedPage: page,
  }) => {
    await searchTaxa(taxonInput(page), "quercus");
    await page.locator(".MuiAutocomplete-option").first().click();
    await expect(page.getByRole("combobox", { name: "Kingdom" })).toHaveCount(0);
  });

  test("free-text species reveals the kingdom select after a prior match is cleared", async ({
    authenticatedPage: page,
  }) => {
    await searchTaxa(taxonInput(page), "quercus");
    await page.locator(".MuiAutocomplete-option").first().click();
    const speciesInput = page.getByLabel(/Taxon/i);
    await speciesInput.fill("My Custom Species");
    await expect(page.getByRole("combobox", { name: "Kingdom" })).toBeVisible();
  });
});
