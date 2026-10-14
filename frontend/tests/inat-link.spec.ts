import type { Page, Route } from "@playwright/test";
import { test, expect } from "./fixtures/mock-auth";
import type { InatAccountResponse } from "../src/bindings/InatAccountResponse";

// These tests never reach iNaturalist: every /api/inat/* call is mocked.

const LINKED: InatAccountResponse = {
  enabled: true,
  login: "kueda",
  linkedAt: "2026-10-07T00:00:00Z",
};
const UNLINKED: InatAccountResponse = { enabled: true, login: null, linkedAt: null };
const DISABLED: InatAccountResponse = { enabled: false, login: null, linkedAt: null };

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

async function mockAccount(page: Page, account: InatAccountResponse) {
  await page.route("**/api/inat/account", (route: Route) => {
    if (route.request().method() === "GET") return route.fulfill(json(account));
    return route.fulfill(json({ success: true }));
  });
}

async function gotoSettings(page: Page) {
  await page.route("**/api/user/preferences", (route: Route) =>
    route.fulfill(json({ defaultLicense: null, basemap: null })),
  );
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

test.describe("iNaturalist - Settings", () => {
  test("offers to connect an account when none is linked", async ({ authenticatedPage: page }) => {
    await mockAccount(page, UNLINKED);
    await page.route("**/api/inat/authorize", (route: Route) =>
      route.fulfill(json({ url: "/settings?inat-linked=1" })),
    );
    await gotoSettings(page);

    await page.getByRole("button", { name: "Connect iNaturalist" }).click();

    // The mocked authorize URL stands in for iNaturalist sending the user back.
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByText("iNaturalist account connected")).toBeVisible();
  });

  test("shows the linked account and disconnects it", async ({ authenticatedPage: page }) => {
    let deleted = false;
    await page.route("**/api/inat/account", (route: Route) => {
      if (route.request().method() === "DELETE") {
        deleted = true;
        return route.fulfill(json({ success: true }));
      }
      return route.fulfill(json(deleted ? UNLINKED : LINKED));
    });
    await gotoSettings(page);

    await expect(page.getByText("Connected as kueda")).toBeVisible();
    await page.getByRole("button", { name: "Disconnect" }).click();

    await expect(page.getByRole("button", { name: "Connect iNaturalist" })).toBeVisible();
    expect(deleted).toBe(true);
  });

  test("says so when linking failed", async ({ authenticatedPage: page }) => {
    await mockAccount(page, UNLINKED);
    await page.route("**/api/user/preferences", (route: Route) =>
      route.fulfill(json({ defaultLicense: null, basemap: null })),
    );
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
