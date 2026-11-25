import { test, expect } from "./fixtures/mock-auth";
import { openUploadModal, gotoUploadStep, searchTaxa } from "./helpers/navigation";
import { mockOwnObservationFeed } from "./helpers/mock-observation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";

test.describe("Accessibility", () => {
  test("tab navigates through interactive elements", async ({ page }) => {
    await page.goto("/");
    // The home route is lazy-loaded and swaps from the feed to the landing page
    // once auth resolves. Wait for a known landing-page control to be visible so
    // the interactive elements are mounted before tabbing through them —
    // otherwise the Tab presses race the Suspense/auth transition, focus falls
    // back to <body>, and `:focus` matches nothing. See issue #607.
    await expect(page.getByRole("button", { name: "Log in" }).first()).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toBeVisible();
  });

  test("pressing Escape closes login modal", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Log in" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});

test.describe("Accessibility - Authenticated", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
  });

  test("pressing Escape closes upload modal", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await openUploadModal(page);
    await gotoUploadStep(page, "Identify");
    await expect(page.getByLabel(/Taxon/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel(/Taxon/i)).not.toBeVisible();
  });

  test("arrow keys navigate autocomplete suggestions", async ({ authenticatedPage: page }) => {
    await mockTaxaSearchRoute(page);
    await page.goto("/");
    await openUploadModal(page);
    await gotoUploadStep(page, "Identify");

    const speciesInput = page.getByLabel(/Taxon/i);
    await searchTaxa(speciesInput, "quercus");
    const option = page.locator(".MuiAutocomplete-option").first();
    await expect(option).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(speciesInput).not.toHaveValue("quercus");
  });
});
