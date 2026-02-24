import { test as authTest, expect as authExpect } from "../fixtures/auth";

const FAB = 'button[aria-label="Create actions"]';

authTest.describe("Auto-Identification on Upload", () => {
  // TC-AUTOID-001: Uploading with a species auto-creates the first identification
  authTest(
    "observation uploaded with species shows auto-created identification",
    async ({ authenticatedPage: page }) => {
      await page.goto("/");

      // Open upload modal
      const fab = page.locator(FAB);
      await authExpect(fab).toBeVisible({ timeout: 5000 });
      await fab.click();
      const newObsAction = page.getByRole("menuitem", {
        name: "New Observation",
      });
      await newObsAction.waitFor({ state: "visible", timeout: 3000 });
      await newObsAction.click();
      await page.waitForTimeout(500);

      // Search and select a species
      const speciesInput = page.getByLabel(/Species/i);
      await speciesInput.click();
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
        speciesInput.pressSequentially("Quercus agrifolia", { delay: 50 }),
      ]);
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible({ timeout: 10000 });
      const selectedSpecies = await option.innerText();
      await option.click();

      // Set location
      const useLocationBtn = page.getByRole("button", {
        name: /Use My Location/i,
      });
      await useLocationBtn.scrollIntoViewIfNeeded();
      await useLocationBtn.click();
      await page.waitForTimeout(1000);

      // Submit (real API, no mocking)
      const submitButton = page.getByRole("button", { name: /Submit/i });
      await authExpect(submitButton).toBeEnabled({ timeout: 3000 });
      await submitButton.click();

      // Wait for redirect to observation detail page
      await page.waitForURL(/\/observation\//, { timeout: 30000 });

      // Verify identification history section appears with the auto-created ID
      const historyHeading = page.getByText("Identification History");
      await authExpect(historyHeading).toBeVisible({ timeout: 15000 });

      // The selected species scientific name should appear in the ID history
      // selectedSpecies may contain "Scientific Name\nCommon Name", extract first line
      const scientificName = selectedSpecies.split("\n")[0].trim();
      await authExpect(page.getByText(scientificName, { exact: false }).first()).toBeVisible({
        timeout: 5000,
      });

      // Community ID should reflect the auto-created identification
      await authExpect(page.getByText("Community ID")).toBeVisible({ timeout: 5000 });

      // Cleanup: delete the observation to avoid polluting the test account
      const url = page.url();
      const match = url.match(/\/observation\/([^/]+)\/([^/]+)/);
      if (match) {
        const [, did, rkey] = match;
        const atUri = `at://${did}/org.rwell.test.occurrence/${rkey}`;
        const resp = await page.request.delete(
          `http://127.0.0.1:3000/api/occurrences/${encodeURIComponent(atUri)}`,
        );
        authExpect(resp.ok()).toBeTruthy();
      }
    },
  );
});
