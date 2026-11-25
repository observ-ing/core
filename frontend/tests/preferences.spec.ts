import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/mock-auth";

// Saving a preference sends only that preference: the server leaves the ones a
// request omits alone, so a client never clears what it hasn't loaded or
// doesn't know about.

/** Answer GET /api/user/preferences with `get`, recording each PUT body. */
async function mockPreferences(page: Page, get: () => { status?: number; json: unknown }) {
  const puts: Array<Record<string, unknown>> = [];
  await page.route("**/api/user/preferences", (route) => {
    if (route.request().method() === "PUT") {
      puts.push(route.request().postDataJSON());
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill(get());
  });
  return puts;
}

async function chooseLicense(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Default license" }).click();
  await page.getByRole("option", { name: label }).click();
}

test.describe("Preferences", () => {
  test("saving the default license sends only the license", async ({ authenticatedPage: page }) => {
    const puts = await mockPreferences(page, () => ({
      json: { defaultLicense: null, basemap: "topo" },
    }));
    await page.goto("/settings");

    await chooseLicense(page, "CC0 (Public Domain)");
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toEqual({
      defaultLicense: "https://creativecommons.org/publicdomain/zero/1.0/",
    });
  });

  test("doesn't clear other preferences when they haven't loaded", async ({
    authenticatedPage: page,
  }) => {
    const puts = await mockPreferences(page, () => ({
      status: 500,
      json: { error: "unavailable" },
    }));
    await page.goto("/settings");

    await chooseLicense(page, "CC0 (Public Domain)");
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).not.toHaveProperty("basemap");
  });
});
