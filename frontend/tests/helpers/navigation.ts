import type { Page } from "@playwright/test";

const FAB = 'button[aria-label="Create actions"]';

/** Steps of the upload modal's vertical stepper, in order. */
export type UploadStep = "Photos" | "Location" | "Identify" | "Date & details";

/**
 * Opens the upload modal via the FAB menu and waits for it to be ready.
 * Replaces hard-coded `waitForTimeout()` calls with a real readiness check.
 *
 * The modal opens on the Photos step; Location/Identify/Date fields live in
 * later steps and are collapsed until revealed via {@link gotoUploadStep}.
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
