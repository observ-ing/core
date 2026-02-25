import { test as authTest, expect as authExpect } from "../fixtures/auth";
import { openUploadModal } from "../helpers/navigation";

authTest.describe("Auto-Identification on Upload", () => {
  // TC-AUTOID-001: Uploading with a species auto-creates the first identification
  authTest(
    "observation uploaded with species shows auto-created identification",
    async ({ authenticatedPage: page }) => {
      await page.goto("/");
      await openUploadModal(page);

      // Search and select a species
      const speciesInput = page.getByLabel(/Species/i);
      await speciesInput.click();
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
        speciesInput.pressSequentially("Quercus agrifolia", { delay: 50 }),
      ]);
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible();
      const selectedSpecies = await option.innerText();
      await option.click();

      // Set location
      const useLocationBtn = page.getByRole("button", {
        name: /Use My Location/i,
      });
      await useLocationBtn.scrollIntoViewIfNeeded();
      await useLocationBtn.click();
      // Wait for location text to appear instead of fixed delay
      await page.getByText(/latitude|location|coordinates/i).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

      // Submit (real API, no mocking)
      const submitButton = page.getByRole("button", { name: /Submit/i });
      await authExpect(submitButton).toBeEnabled({ timeout: 3000 });
      await submitButton.click();

      // Wait for redirect to observation detail page
      await page.waitForURL(/\/observation\//, { timeout: 30000 });

      // Verify identification history section appears with the auto-created ID
      const historyHeading = page.getByText("Identification History");
      await authExpect(historyHeading).toBeVisible();

      // The selected species scientific name should appear in the ID history
      // selectedSpecies may contain "Scientific Name\nCommon Name", extract first line
      const scientificName = selectedSpecies.split("\n")[0].trim();
      await authExpect(page.getByText(scientificName, { exact: false }).first()).toBeVisible();

      // Community ID should reflect the auto-created identification
      await authExpect(page.getByText("Community ID")).toBeVisible();

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
