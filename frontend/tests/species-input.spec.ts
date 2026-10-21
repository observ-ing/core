import { test, expect } from "./fixtures/mock-auth";
import { openUploadModal, gotoUploadStep } from "./helpers/navigation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";
import { mockOwnObservationFeed } from "./helpers/mock-observation";

/** Type into the species input and wait for the autocomplete options to appear. */
async function searchSpecies(page: import("@playwright/test").Page, query: string) {
  const speciesInput = page.getByLabel(/Taxon/i);
  await speciesInput.click();
  await Promise.all([
    page.waitForResponse(
      (r) => {
        if (!r.url().includes("/api/taxa/search")) return false;
        try {
          const q = new URL(r.url()).searchParams.get("q") || "";
          return q.length >= query.length;
        } catch {
          return false;
        }
      },
      { timeout: 15_000 },
    ),
    speciesInput.pressSequentially(query, { delay: 50 }),
  ]);
  return speciesInput;
}

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
    await searchSpecies(page, "california poppy");
    const option = page.locator(".MuiAutocomplete-option").first();
    await expect(option).toBeVisible();
  });

  test("typing a scientific name shows matching species", async ({ authenticatedPage: page }) => {
    await searchSpecies(page, "Quercus");
    const option = page.locator(".MuiAutocomplete-option").first();
    await expect(option).toBeVisible();
    await expect(page.locator(".MuiAutocomplete-popper")).toContainText(/quercus/i);
  });

  test("lowercase scientific name still finds results", async ({ authenticatedPage: page }) => {
    await searchSpecies(page, "quercus alba");
    const option = page.locator(".MuiAutocomplete-option").first();
    await expect(option).toBeVisible();
  });

  test("selecting an autocomplete suggestion populates the input", async ({
    authenticatedPage: page,
  }) => {
    const speciesInput = await searchSpecies(page, "quercus");
    const option = page.locator(".MuiAutocomplete-option").first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(speciesInput).not.toHaveValue("");
    await expect(page.locator(".MuiAutocomplete-popper")).not.toBeVisible();
  });

  test("selecting an autocomplete suggestion hides the kingdom select", async ({
    authenticatedPage: page,
  }) => {
    await searchSpecies(page, "quercus");
    await page.locator(".MuiAutocomplete-option").first().click();
    await expect(page.getByRole("combobox", { name: "Kingdom" })).toHaveCount(0);
  });

  test("free-text species reveals the kingdom select after a prior match is cleared", async ({
    authenticatedPage: page,
  }) => {
    await searchSpecies(page, "quercus");
    await page.locator(".MuiAutocomplete-option").first().click();
    const speciesInput = page.getByLabel(/Taxon/i);
    await speciesInput.fill("My Custom Species");
    await expect(page.getByRole("combobox", { name: "Kingdom" })).toBeVisible();
  });
});
