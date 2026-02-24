import { test as authTest, expect as authExpect } from "../fixtures/auth";

const FAB = 'button[aria-label="Create actions"]';

/** Type into the species input and wait for the taxa search response that
 *  matches the full query. Filters by query-param length so we skip early
 *  responses triggered by partial (debounced) input. */
async function searchSpecies(page: import("@playwright/test").Page, query: string) {
  const speciesInput = page.getByLabel(/Species/i);
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
      { timeout: 15000 },
    ),
    speciesInput.pressSequentially(query, { delay: 50 }),
  ]);
  return speciesInput;
}

authTest.describe("Species Input", () => {
  authTest.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.locator(FAB).waitFor({ timeout: 5000 });
    await page.locator(FAB).click();
    const newObsAction = page.getByRole("menuitem", {
      name: "New Observation",
    });
    await newObsAction.waitFor({ state: "visible", timeout: 3000 });
    await newObsAction.click();
    await page.waitForTimeout(500);
  });

  // TC-SPECIES-001: Common name autocomplete
  authTest(
    "typing a common name shows scientific name in suggestions",
    async ({ authenticatedPage: page }) => {
      await searchSpecies(page, "california poppy");
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible({ timeout: 10000 });
    },
  );

  // TC-SPECIES-004: Scientific name still works
  authTest(
    "typing a scientific name shows matching species",
    async ({ authenticatedPage: page }) => {
      await searchSpecies(page, "Quercus");
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible({ timeout: 10000 });
      await authExpect(page.locator(".MuiAutocomplete-popper")).toContainText(/quercus/i, {
        timeout: 10000,
      });
    },
  );

  // TC-SPECIES-005: Mixed case scientific name
  authTest("lowercase scientific name still finds results", async ({ authenticatedPage: page }) => {
    await searchSpecies(page, "quercus alba");
    const option = page.locator(".MuiAutocomplete-option").first();
    await authExpect(option).toBeVisible({ timeout: 10000 });
  });

  // TC-UPLOAD-007: Autocomplete selection
  authTest(
    "selecting an autocomplete suggestion populates the input",
    async ({ authenticatedPage: page }) => {
      const speciesInput = await searchSpecies(page, "quercus");
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible({ timeout: 10000 });
      await option.click();
      await authExpect(speciesInput).not.toHaveValue("");
      await authExpect(page.locator(".MuiAutocomplete-popper")).not.toBeVisible();
    },
  );
});
