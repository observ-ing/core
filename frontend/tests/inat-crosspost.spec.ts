import type { Page, Route } from "@playwright/test";
import { test, expect } from "./fixtures/mock-auth";
import { MOCK_OBS_URL, mockObservationDetailRoute } from "./helpers/mock-observation";
import type { InatAccountResponse } from "../src/bindings/InatAccountResponse";
import type { CrosspostStatusResponse } from "../src/bindings/CrosspostStatusResponse";

// These tests never reach iNaturalist: every /api/inat/* call is mocked.

const LINKED: InatAccountResponse = {
  enabled: true,
  login: "kueda",
  linkedAt: "2026-10-07T00:00:00Z",
};
const UNLINKED: InatAccountResponse = { enabled: true, login: null, linkedAt: null };
const DISABLED: InatAccountResponse = { enabled: false, login: null, linkedAt: null };

const NOT_POSTED: CrosspostStatusResponse = { status: null, lastError: null, inatUrl: null };

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

/**
 * Mock the crosspost endpoint. GET returns `status`; POST records the call
 * and switches GET over to `afterPost`.
 */
async function mockCrosspost(
  page: Page,
  status: CrosspostStatusResponse,
  afterPost: CrosspostStatusResponse = {
    status: "pending",
    lastError: null,
    inatUrl: null,
  },
) {
  const calls = { posts: 0 };
  let current = status;
  await page.route("**/api/inat/crosspost/**", (route: Route) => {
    if (route.request().method() === "POST") {
      calls.posts += 1;
      current = afterPost;
      return route.fulfill(json(current, 202));
    }
    return route.fulfill(json(current));
  });
  return calls;
}

async function gotoSettings(page: Page) {
  await page.route("**/api/user/preferences", (route: Route) =>
    route.fulfill(json({ defaultLicense: null, basemap: null })),
  );
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

async function gotoOwnObservation(page: Page, overrides = {}) {
  await mockObservationDetailRoute(page, overrides);
  await page.goto(MOCK_OBS_URL);
  await page.getByText("Observed").waitFor({ timeout: 15_000 });
}

async function openMenu(page: Page) {
  await page.getByLabel("More options").first().click();
  // Edit is always there for the owner, so the menu has finished rendering.
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
}

test.describe("iNaturalist - Settings", () => {
  test("offers to connect an account when none is linked", async ({ authenticatedPage: page }) => {
    await mockAccount(page, UNLINKED);
    await page.route("**/api/inat/authorize", (route: Route) =>
      route.fulfill(json({ url: "http://127.0.0.1:3000/settings?inat-linked=1" })),
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

  test("is absent when the server has cross-posting turned off", async ({
    authenticatedPage: page,
  }) => {
    await mockAccount(page, DISABLED);
    await gotoSettings(page);

    await expect(page.getByText("Upload defaults")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect iNaturalist" })).toHaveCount(0);
  });
});

test.describe("iNaturalist - Post an existing observation", () => {
  test("posts from the menu and shows it is pending", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    const calls = await mockCrosspost(page, NOT_POSTED);
    await gotoOwnObservation(page);

    await openMenu(page);
    await page.getByRole("menuitem", { name: "Post to iNaturalist" }).click();

    await expect(page.getByText("Posting to iNaturalist")).toBeVisible();
    expect(calls.posts).toBe(1);

    // Once queued it can't be posted again.
    await openMenu(page);
    await expect(page.getByRole("menuitem", { name: /iNaturalist/ })).toHaveCount(0);
  });

  test("links to the iNaturalist observation once posted", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    await mockCrosspost(page, {
      status: "synced",
      lastError: null,
      inatUrl: "https://www.inaturalist.org/observations/123",
    });
    await gotoOwnObservation(page);

    await expect(page.getByRole("link", { name: "View on iNaturalist" })).toHaveAttribute(
      "href",
      "https://www.inaturalist.org/observations/123",
    );
    await openMenu(page);
    await expect(page.getByRole("menuitem", { name: /iNaturalist/ })).toHaveCount(0);
  });

  test("offers a retry when posting failed", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    const calls = await mockCrosspost(page, {
      status: "failed",
      lastError: "iNaturalist returned 422",
      inatUrl: null,
    });
    await gotoOwnObservation(page);

    await expect(page.getByText("Couldn't post to iNaturalist")).toBeVisible();
    await openMenu(page);
    await page.getByRole("menuitem", { name: "Retry posting to iNaturalist" }).click();

    await expect(page.getByText("Posting to iNaturalist")).toBeVisible();
    expect(calls.posts).toBe(1);
  });

  test("is not offered for an observation that already links to iNaturalist", async ({
    authenticatedPage: page,
  }) => {
    await mockAccount(page, LINKED);
    await mockCrosspost(page, NOT_POSTED);
    await gotoOwnObservation(page, {
      externalRecords: [{ uri: "https://inaturalist.nz/observations/9" }],
    });

    await openMenu(page);
    await expect(page.getByRole("menuitem", { name: /iNaturalist/ })).toHaveCount(0);
  });

  test("is not offered without a linked account", async ({ authenticatedPage: page }) => {
    await mockAccount(page, UNLINKED);
    await mockCrosspost(page, NOT_POSTED);
    await gotoOwnObservation(page);

    await openMenu(page);
    await expect(page.getByRole("menuitem", { name: /iNaturalist/ })).toHaveCount(0);
  });

  test("is not offered on someone else's observation", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    await mockCrosspost(page, NOT_POSTED);
    await gotoOwnObservation(page, {
      observer: { did: "did:plc:someoneelse", handle: "other.test" },
    });

    await page.getByLabel("More options").first().click();
    await expect(page.getByRole("menuitem", { name: "View on AT Protocol" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /iNaturalist/ })).toHaveCount(0);
  });
});
