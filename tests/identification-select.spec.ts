// Regression coverage for #419 — the Suggest ID autocomplete in the
// observation page should let users open a taxon in a new tab without
// accidentally selecting the suggestion.
import { test as authTest, expect as authExpect } from "./fixtures/mock-auth";
import { navigateToMockedDetail } from "./helpers/mock-observation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";

authTest.describe("Suggest ID autocomplete options", () => {
  authTest.beforeEach(async ({ authenticatedPage: page }) => {
    await mockTaxaSearchRoute(page);
    await navigateToMockedDetail(page);
    await page.getByRole("button", { name: "Suggest Different ID" }).click();
  });

  authTest(
    "clicking a suggestion populates the Taxon Name input",
    async ({ authenticatedPage: page }) => {
      const taxonInput = page.getByRole("combobox", { name: "Taxon Name" });
      await authExpect(taxonInput).toBeVisible();
      await taxonInput.click();

      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
        taxonInput.pressSequentially("quercus", { delay: 50 }),
      ]);

      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible();
      await option.click();

      await authExpect(taxonInput).toHaveValue("Quercus alba");
      await authExpect(page.locator(".MuiAutocomplete-popper")).not.toBeVisible();
    },
  );

  authTest(
    "each suggestion exposes an open-in-new-tab link to its taxon page",
    async ({ authenticatedPage: page }) => {
      const taxonInput = page.getByRole("combobox", { name: "Taxon Name" });
      await taxonInput.click();
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
        taxonInput.pressSequentially("quercus", { delay: 50 }),
      ]);

      const albaLink = page.getByRole("link", { name: /open quercus alba in new tab/i });
      await authExpect(albaLink).toBeVisible();
      await authExpect(albaLink).toHaveAttribute("href", "/taxon/Plantae/Quercus-alba");
      await authExpect(albaLink).toHaveAttribute("target", "_blank");
    },
  );

  authTest(
    "clicking the open-in-new-tab link does not select the suggestion",
    async ({ authenticatedPage: page }) => {
      const taxonInput = page.getByRole("combobox", { name: "Taxon Name" });
      await taxonInput.click();
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
        taxonInput.pressSequentially("quercus", { delay: 50 }),
      ]);

      const albaLink = page.getByRole("link", { name: /open quercus alba in new tab/i });
      await authExpect(albaLink).toBeVisible();

      // Real users see the link open a new tab; we just need to drive the
      // click so MUI's option-row pointer handler sees the event. Letting
      // the anchor navigate would leave the test on /taxon/... so we
      // neutralize target before clicking.
      await albaLink.evaluate((el: HTMLAnchorElement) => {
        el.removeAttribute("target");
        el.setAttribute("href", "javascript:void(0)");
      });
      await albaLink.click();

      // The suggestion must NOT have been picked: input still has the typed
      // text, not the suggestion's scientificName.
      await authExpect(taxonInput).toHaveValue("quercus");
    },
  );
});
