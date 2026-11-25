import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/mock-auth";
import { DISABLED, LINKED, UNLINKED, mockAccount } from "./helpers/inat";
import { mockJson } from "./helpers/mock-api";

// These tests never reach iNaturalist: every /api/inat/* call is mocked.

const mockPreferences = (page: Page) =>
  mockJson(page, "**/api/user/preferences", { defaultLicense: null, basemap: null });

async function gotoSettings(page: Page) {
  await mockPreferences(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

test.describe("iNaturalist - Settings", () => {
  test("offers to connect an account when none is linked", async ({ authenticatedPage: page }) => {
    await mockAccount(page, UNLINKED);
    await mockJson(page, "**/api/inat/authorize", { url: "/settings?inat-linked=1" });
    await gotoSettings(page);

    await page.getByRole("button", { name: "Connect iNaturalist" }).click();

    // The mocked authorize URL stands in for iNaturalist sending the user back.
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByText("iNaturalist account connected")).toBeVisible();
  });

  test("shows the linked account and disconnects it", async ({ authenticatedPage: page }) => {
    let deleted = false;
    await page.route("**/api/inat/account", (route) => {
      if (route.request().method() === "DELETE") {
        deleted = true;
        return route.fulfill({ json: { success: true } });
      }
      return route.fulfill({ json: deleted ? UNLINKED : LINKED });
    });
    await gotoSettings(page);

    await expect(page.getByText("Connected as kueda")).toBeVisible();
    await page.getByRole("button", { name: "Disconnect" }).click();

    await expect(page.getByRole("button", { name: "Connect iNaturalist" })).toBeVisible();
    expect(deleted).toBe(true);
  });

  test("says so when linking failed", async ({ authenticatedPage: page }) => {
    await mockAccount(page, UNLINKED);
    await mockPreferences(page);
    await page.goto("/settings?inat-error=1");

    await expect(page.getByText("Couldn't connect your iNaturalist account")).toBeVisible();
  });

  test("is absent when the server has iNaturalist turned off", async ({
    authenticatedPage: page,
  }) => {
    await mockAccount(page, DISABLED);
    await gotoSettings(page);

    await expect(page.getByText("Upload defaults")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect iNaturalist" })).toHaveCount(0);
  });
});
