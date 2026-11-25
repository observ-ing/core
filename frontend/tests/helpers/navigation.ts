import type { Locator, Page } from "@playwright/test";

/** Steps of the upload modal's vertical stepper, in order. */
export type UploadStep = "Photos" | "Location" | "Identify" | "Date & details";

/**
 * Opens the upload modal via the top bar's "Add observation" button and waits
 * for it to be ready. Needs a wide viewport: narrow ones get the FAB speed dial
 * instead. Replaces hard-coded `waitForTimeout()` calls with a real readiness
 * check.
 *
 * The modal opens on the Photos step; Location/Identify/Date fields live in
 * later steps and are collapsed until revealed via {@link gotoUploadStep}.
 */
export async function openUploadModal(page: Page) {
  const button = page.getByRole("button", { name: "Add observation" });
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await button.click();
  // Wait for the modal to actually render instead of a fixed delay. The heading
  // is always present regardless of which step is active.
  await page
    .getByRole("dialog")
    .getByRole("heading", { name: "New Observation" })
    .waitFor({ state: "visible", timeout: 10_000 });
}

/**
 * Reveals a step's content in the upload modal's (non-linear) vertical stepper
 * by clicking its step header. Required before interacting with fields that
 * live in a collapsed step — e.g. Taxon (Identify) or the date inputs
 * (Date & details). Step state is preserved across navigation, so callers may
 * fill steps in any order.
 */
export async function gotoUploadStep(page: Page, step: UploadStep) {
  await page.getByRole("dialog").locator(".MuiStepLabel-root", { hasText: step }).click();
}

/**
 * Expands the collapsed manual-coordinate inputs in LocationPicker so that
 * the Latitude/Longitude TextFields become accessible. Navigates to the
 * Location step first, since the picker lives in a collapsed step.
 */
export async function revealCoordinateInputs(page: Page) {
  await gotoUploadStep(page, "Location");
  const toggle = page.getByRole("button", { name: "Enter coordinates manually" });
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await page.getByLabel("Latitude").waitFor({ state: "visible", timeout: 5_000 });
}

/**
 * Types `query` into a taxon autocomplete and waits for the search covering
 * all of it. The search is debounced, so a response for a prefix may arrive
 * first; waiting on that one would race the options for the full query.
 */
export async function searchTaxa(input: Locator, query: string) {
  await input.click();
  await Promise.all([
    input.page().waitForResponse((r) => {
      const url = new URL(r.url());
      return (
        url.pathname.endsWith("/api/taxa/search") &&
        (url.searchParams.get("q") ?? "").length >= query.length
      );
    }),
    input.pressSequentially(query, { delay: 50 }),
  ]);
}

/** Opens the first feed card's observation and waits for its detail page. */
export async function openFirstCard(page: Page) {
  await page.locator(".MuiCard-root").first().locator(".MuiCardActionArea-root").click();
  await page.waitForURL(/\/observation\//);
}

/** Opens the first feed card's "More options" menu. */
export async function openFirstCardMenu(page: Page) {
  await page.locator(".MuiCard-root").first().getByLabel("More options").click();
}
