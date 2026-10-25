// Regression coverage for #419 — the Suggest ID autocomplete in the
// observation page should let users open a taxon in a new tab without
// accidentally selecting the suggestion.
import { test, expect } from "./fixtures/mock-auth";
import { navigateToMockedDetail } from "./helpers/mock-observation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";

test.describe("Suggest ID autocomplete options", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockTaxaSearchRoute(page);
    await navigateToMockedDetail(page);
    await page.getByRole("button", { name: "Suggest Different ID" }).click();
  });

  test("clicking a suggestion populates the Taxon Name input", async ({
    authenticatedPage: page,
  }) => {
    const taxonInput = page.getByRole("combobox", { name: "Taxon Name" });
    await expect(taxonInput).toBeVisible();
    await taxonInput.click();

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
      taxonInput.pressSequentially("quercus", { delay: 50 }),
    ]);

    const option = page.locator(".MuiAutocomplete-option").first();
    await expect(option).toBeVisible();
    await option.click();

    await expect(taxonInput).toHaveValue("Quercus alba");
    await expect(page.locator(".MuiAutocomplete-popper")).not.toBeVisible();
  });

  test("each suggestion exposes an open-in-new-tab link to its taxon page", async ({
    authenticatedPage: page,
  }) => {
    const taxonInput = page.getByRole("combobox", { name: "Taxon Name" });
    await taxonInput.click();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
      taxonInput.pressSequentially("quercus", { delay: 50 }),
    ]);

    const albaLink = page.getByRole("link", { name: /open quercus alba in new tab/i });
    await expect(albaLink).toBeVisible();
    await expect(albaLink).toHaveAttribute("href", "/taxon/Plantae/Quercus-alba");
    await expect(albaLink).toHaveAttribute("target", "_blank");
  });

  test("clicking the open-in-new-tab link opens a new tab and keeps the popper open", async ({
    authenticatedPage: page,
  }) => {
    const taxonInput = page.getByRole("combobox", { name: "Taxon Name" });
    await taxonInput.click();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
      taxonInput.pressSequentially("quercus", { delay: 50 }),
    ]);

    const albaLink = page.getByRole("link", { name: /open quercus alba in new tab/i });
    await expect(albaLink).toBeVisible();

    // The real failure for issue #419 follow-up was that mousedown
    // shifted focus, MUI closed the popper, and the anchor unmounted
    // before `click` fired — so no new tab opened either. Drive a
    // real mousedown + click on the icon (not the anchor child) so
    // MUI's row-mousedown handler sees the same event chain a user
    // would produce, then assert: (a) a new tab opened, (b) the
    // suggestion was NOT picked, (c) the popper is still open.
    const popupPromise = page.waitForEvent("popup", { timeout: 5000 });
    await albaLink.click();
    const popup = await popupPromise;
    await popup.close();

    await expect(taxonInput).toHaveValue("quercus");
    await expect(page.locator(".MuiAutocomplete-option").first()).toBeVisible();
  });
});
