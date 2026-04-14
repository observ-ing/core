import { test as authTest, expect as authExpect } from "./fixtures/mock-auth";
import { openUploadModal } from "./helpers/navigation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";
import { mockOwnObservationFeed } from "./helpers/mock-observation";

/** Type into the species input and wait for the autocomplete options to appear. */
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
    await mockOwnObservationFeed(page);
    await mockTaxaSearchRoute(page);
    await page.goto("/");
    await openUploadModal(page);
  });

  // TC-SPECIES-001: Common name autocomplete
  authTest(
    "typing a common name shows scientific name in suggestions",
    async ({ authenticatedPage: page }) => {
      await searchSpecies(page, "california poppy");
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible();
    },
  );

  // TC-SPECIES-004: Scientific name still works
  authTest(
    "typing a scientific name shows matching species",
    async ({ authenticatedPage: page }) => {
      await searchSpecies(page, "Quercus");
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible();
      await authExpect(page.locator(".MuiAutocomplete-popper")).toContainText(/quercus/i);
    },
  );

  // TC-SPECIES-005: Mixed case scientific name
  authTest("lowercase scientific name still finds results", async ({ authenticatedPage: page }) => {
    await searchSpecies(page, "quercus alba");
    const option = page.locator(".MuiAutocomplete-option").first();
    await authExpect(option).toBeVisible();
  });

  // TC-UPLOAD-007: Autocomplete selection
  authTest(
    "selecting an autocomplete suggestion populates the input",
    async ({ authenticatedPage: page }) => {
      const speciesInput = await searchSpecies(page, "quercus");
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible();
      await option.click();
      await authExpect(speciesInput).not.toHaveValue("");
      await authExpect(page.locator(".MuiAutocomplete-popper")).not.toBeVisible();
    },
  );

  authTest(
    "selecting an autocomplete suggestion auto-fills and disables the kingdom select",
    async ({ authenticatedPage: page }) => {
      await searchSpecies(page, "quercus");
      await page.locator(".MuiAutocomplete-option").first().click();
      const kingdomCombo = page.getByRole("combobox", { name: "Kingdom" });
      await authExpect(kingdomCombo).toHaveText("Plants");
      await authExpect(kingdomCombo).toHaveAttribute("aria-disabled", "true");
    },
  );

  authTest(
    "searching by common name 'cat' and selecting Felis catus auto-fills Animals",
    async ({ authenticatedPage: page }) => {
      await searchSpecies(page, "cat");
      await page.locator(".MuiAutocomplete-option").first().click();
      const kingdomCombo = page.getByRole("combobox", { name: "Kingdom" });
      await authExpect(kingdomCombo).toHaveText("Animals");
      await authExpect(kingdomCombo).toHaveAttribute("aria-disabled", "true");
    },
  );

  // Simulates user typing a species, seeing suggestions, then pressing Enter
  // instead of clicking a suggestion. freeSolo mode should still auto-fill
  // kingdom if the typed text exactly matches a loaded option.
  authTest(
    "typing 'Felis catus' and pressing Enter auto-fills kingdom",
    async ({ authenticatedPage: page }) => {
      const speciesInput = page.getByRole("combobox", { name: /Species/i });
      await speciesInput.click();
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
        speciesInput.pressSequentially("cat", { delay: 50 }),
      ]);
      await authExpect(page.locator(".MuiAutocomplete-option").first()).toBeVisible();
      await speciesInput.press("Enter");
      const kingdomCombo = page.getByRole("combobox", { name: "Kingdom" });
      await authExpect(kingdomCombo).toHaveText("Animals");
    },
  );

  authTest(
    "free-text species enables the kingdom select and clears any prior match",
    async ({ authenticatedPage: page }) => {
      await searchSpecies(page, "quercus");
      await page.locator(".MuiAutocomplete-option").first().click();
      const speciesInput = page.getByLabel(/Species/i);
      await speciesInput.fill("My Custom Species");
      const kingdomCombo = page.getByRole("combobox", { name: "Kingdom" });
      await authExpect(kingdomCombo).not.toHaveAttribute("aria-disabled", "true");
    },
  );
});
