import {
  test as authTest,
  expect as authExpect,
} from "../fixtures/auth";

const FAB = 'button[aria-label="Create actions"]';

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
      const speciesInput = page.getByLabel(/Species/i);
      await speciesInput.fill("california poppy");
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible({ timeout: 5000 });
      await authExpect(page.locator(".MuiAutocomplete-popper")).toContainText(/Eschscholzia/i);
    },
  );

  // TC-SPECIES-004: Scientific name still works
  authTest(
    "typing a scientific name shows matching species",
    async ({ authenticatedPage: page }) => {
      const speciesInput = page.getByLabel(/Species/i);
      await speciesInput.fill("Quercus");
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible({ timeout: 5000 });
      await authExpect(page.locator(".MuiAutocomplete-popper")).toContainText(/Quercus/);
    },
  );

  // TC-SPECIES-005: Mixed case scientific name
  authTest(
    "lowercase scientific name still finds results",
    async ({ authenticatedPage: page }) => {
      const speciesInput = page.getByLabel(/Species/i);
      await speciesInput.fill("quercus alba");
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible({ timeout: 5000 });
    },
  );

  // TC-UPLOAD-007: Autocomplete selection
  authTest(
    "selecting an autocomplete suggestion populates the input",
    async ({ authenticatedPage: page }) => {
      const speciesInput = page.getByLabel(/Species/i);
      await speciesInput.fill("quercus");
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible({ timeout: 5000 });
      await option.click();
      await authExpect(speciesInput).not.toHaveValue("");
      await authExpect(page.locator(".MuiAutocomplete-popper")).not.toBeVisible();
    },
  );
});
