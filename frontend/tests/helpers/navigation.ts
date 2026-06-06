import type { Page } from "@playwright/test";

const FAB = 'button[aria-label="Create actions"]';

/**
 * Opens the upload modal via the FAB menu and waits for it to be ready.
 * Replaces hard-coded `waitForTimeout()` calls with a real readiness check.
 */
export async function openUploadModal(page: Page) {
  const fab = page.locator(FAB);
  await fab.waitFor({ state: "visible", timeout: 10_000 });
  await fab.click();
  const newObsAction = page.getByRole("menuitem", {
    name: "New Observation",
  });
  await newObsAction.waitFor({ state: "visible", timeout: 5_000 });
  await newObsAction.click();
  // Wait for the modal content to actually render instead of a fixed delay
  await page.getByLabel(/Taxon/i).waitFor({ state: "visible", timeout: 10_000 });
}

/**
 * Expands the collapsed manual-coordinate inputs in LocationPicker so that
 * the Latitude/Longitude TextFields become accessible.
 */
export async function revealCoordinateInputs(page: Page) {
  const toggle = page.getByRole("button", { name: "Enter coordinates manually" });
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await page.getByLabel("Latitude").waitFor({ state: "visible", timeout: 5_000 });
}
