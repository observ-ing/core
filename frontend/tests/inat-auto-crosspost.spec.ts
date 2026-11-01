import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/mock-auth";
import { LINKED, mockAccount } from "./helpers/inat";
import type { UserPreferencesResponse } from "../src/bindings/UserPreferencesResponse";

// Posting new observations to iNaturalist as they are uploaded (#998). These
// tests never reach iNaturalist: the server queues the cross-post, and every
// /api/inat/* call is mocked.

const UNSET: UserPreferencesResponse = {
  defaultLicense: null,
  basemap: null,
  crosspostInaturalist: null,
  crosspostInaturalistRequirePhotos: null,
};

/** Answer GET /api/user/preferences with `prefs`, recording each PUT body. */
async function mockPreferences(page: Page, prefs: UserPreferencesResponse) {
  const puts: Array<Record<string, unknown>> = [];
  await page.route("**/api/user/preferences", (route) => {
    if (route.request().method() === "PUT") {
      puts.push(route.request().postDataJSON());
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: prefs });
  });
  return puts;
}

test.describe("iNaturalist - Settings for new observations", () => {
  test("turns posting on, sending only that change", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    const puts = await mockPreferences(page, { ...UNSET, defaultLicense: "CC0-1.0" });
    await page.goto("/settings");

    const requirePhotos = page.getByRole("switch", { name: "Only observations with photos" });
    await expect(requirePhotos).toBeDisabled();
    await expect(requirePhotos).toBeChecked();
    const autoPost = page.getByRole("switch", { name: "Post new observations to iNaturalist" });
    // Not check(): the saved value lands a tick after the click, once the
    // mutation has cancelled any preferences fetch in flight.
    await autoPost.click();

    await expect(autoPost).toBeChecked();
    await expect(requirePhotos).toBeEnabled();
    await expect.poll(() => puts.length).toBe(1);
    // The server leaves what a request omits alone, so the other preferences
    // aren't sent back, as blanks or otherwise.
    expect(puts[0]).toEqual({ crosspostInaturalist: true });
  });
});
