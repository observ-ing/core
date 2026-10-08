import type { Page, Route } from "@playwright/test";
import { test, expect } from "./fixtures/mock-auth";
import {
  MOCK_OBS_DID,
  MOCK_OBS_RKEY,
  MOCK_OBS_URL,
  mockObservationDetailRoute,
} from "./helpers/mock-observation";
import { gotoUploadStep } from "./helpers/navigation";
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
  const calls = { posts: 0, postedUris: [] as string[] };
  let current = status;
  await page.route("**/api/inat/crosspost/**", (route: Route) => route.fulfill(json(current)));
  await page.route("**/api/inat/crosspost", (route: Route) => {
    calls.posts += 1;
    calls.postedUris.push(route.request().postDataJSON()?.uri);
    current = afterPost;
    return route.fulfill(json(current, 202));
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

/** The "Also recorded on" row of the Details list. */
function alsoRecordedOn(page: Page) {
  return page.getByRole("listitem").filter({ hasText: "Also recorded on" });
}

const postButton = (page: Page) => page.getByRole("button", { name: "Post to iNaturalist" });
const retryButton = (page: Page) =>
  page.getByRole("button", { name: "Retry posting to iNaturalist" });

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
  test("posts from the observation's details and shows it is pending", async ({
    authenticatedPage: page,
  }) => {
    await mockAccount(page, LINKED);
    const calls = await mockCrosspost(page, NOT_POSTED);
    await gotoOwnObservation(page);

    // With no links to list, the button stands on its own: no "Also recorded
    // on" label for something that isn't recorded anywhere else yet.
    await expect(postButton(page)).toBeVisible();
    await expect(alsoRecordedOn(page)).toHaveCount(0);
    await postButton(page).click();

    const posting = page.getByRole("status").filter({ hasText: "Posting to iNaturalist" });
    await expect(posting).toBeVisible();
    await expect(posting.getByRole("progressbar")).toBeVisible();
    await expect(alsoRecordedOn(page)).toHaveCount(0);
    expect(calls.postedUris).toEqual([
      `at://${MOCK_OBS_DID}/bio.lexicons.temp.v0-1.occurrence/${MOCK_OBS_RKEY}`,
    ]);
    // Once queued it can't be posted again.
    await expect(postButton(page)).toHaveCount(0);
  });

  test("sits below links the observation already has", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    await mockCrosspost(page, NOT_POSTED);
    await gotoOwnObservation(page, {
      externalRecords: [{ uri: "https://bugguide.net/node/view/1", service: "bugguide" }],
    });

    const row = alsoRecordedOn(page);
    await expect(row.getByRole("link", { name: "BugGuide" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Post to iNaturalist" })).toBeVisible();
  });

  test("links to the iNaturalist observation once posted", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    await mockCrosspost(page, {
      status: "synced",
      lastError: null,
      inatUrl: "https://www.inaturalist.org/observations/123",
    });
    await gotoOwnObservation(page);

    // Shown from the cross-post status, before the link has reached the record.
    await expect(alsoRecordedOn(page).getByRole("link", { name: "iNaturalist" })).toHaveAttribute(
      "href",
      "https://www.inaturalist.org/observations/123",
    );
    await expect(postButton(page)).toHaveCount(0);
  });

  test("shows the link once, after it has reached the record", async ({
    authenticatedPage: page,
  }) => {
    const inatUrl = "https://www.inaturalist.org/observations/123";
    await mockAccount(page, LINKED);
    await mockCrosspost(page, { status: "synced", lastError: null, inatUrl });
    await gotoOwnObservation(page, {
      externalRecords: [{ uri: inatUrl, service: "inaturalist" }],
    });

    await expect(alsoRecordedOn(page).getByRole("link", { name: "iNaturalist" })).toHaveCount(1);
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
    await expect(page.getByText("iNaturalist returned 422")).toBeVisible();
    await expect(alsoRecordedOn(page)).toHaveCount(0);
    await retryButton(page).click();

    await expect(page.getByText("Posting to iNaturalist")).toBeVisible();
    expect(calls.posts).toBe(1);
  });

  test("offers a retry when posting failed after the link was added", async ({
    authenticatedPage: page,
  }) => {
    // The link goes on the record before the photos are uploaded, so a photo
    // failure leaves a failed cross-post on an observation that has its link.
    const inatUrl = "https://www.inaturalist.org/observations/123";
    await mockAccount(page, LINKED);
    const calls = await mockCrosspost(page, {
      status: "failed",
      lastError: "Could not fetch photo bafkrei1 from your PDS",
      inatUrl,
    });
    await gotoOwnObservation(page, {
      externalRecords: [{ uri: inatUrl, service: "inaturalist" }],
    });

    const row = alsoRecordedOn(page);
    await expect(row.getByRole("link", { name: "iNaturalist" })).toHaveCount(1);
    await expect(row.getByText("Couldn't post to iNaturalist")).toBeVisible();
    await retryButton(page).click();

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

    await expect(alsoRecordedOn(page)).toBeVisible();
    await expect(postButton(page)).toHaveCount(0);
  });

  test("the edit form can't remove the link that posting added", async ({
    authenticatedPage: page,
  }) => {
    const inatUrl = "https://www.inaturalist.org/observations/123";
    await mockAccount(page, LINKED);
    await mockCrosspost(page, { status: "synced", lastError: null, inatUrl });
    await gotoOwnObservation(page, {
      externalRecords: [
        { uri: "https://bugguide.net/node/view/1", service: "bugguide" },
        { uri: inatUrl, service: "inaturalist" },
      ],
    });

    await page.getByLabel("More options").first().click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await gotoUploadStep(page, "Date & details");

    const chips = page.getByRole("dialog").locator(".MuiChip-root");
    const bugguide = chips.filter({ hasText: "BugGuide" });
    const inaturalist = chips.filter({ hasText: "iNaturalist" });
    await expect(bugguide).toBeVisible();
    await expect(inaturalist).toBeVisible();
    // A link someone typed in can be removed; the cross-post's can't.
    await expect(bugguide.locator(".MuiChip-deleteIcon")).toHaveCount(1);
    await expect(inaturalist.locator(".MuiChip-deleteIcon")).toHaveCount(0);
  });

  test("is not offered without a linked account", async ({ authenticatedPage: page }) => {
    await mockAccount(page, UNLINKED);
    await mockCrosspost(page, NOT_POSTED);
    await gotoOwnObservation(page);

    await expect(page.getByText("Coordinates")).toBeVisible();
    await expect(postButton(page)).toHaveCount(0);
    await expect(alsoRecordedOn(page)).toHaveCount(0);
  });

  test("is not offered without a linked account even after editing", async ({
    authenticatedPage: page,
  }) => {
    // The edit form looks up the cross-post status for its own purposes. That
    // lookup must not make the detail page think the viewer can post.
    await mockAccount(page, UNLINKED);
    await mockCrosspost(page, NOT_POSTED);
    await gotoOwnObservation(page);

    await page.getByLabel("More options").first().click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expect(page.getByText("Coordinates")).toBeVisible();
    await expect(postButton(page)).toHaveCount(0);
  });

  test("is not offered on someone else's observation", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    await mockCrosspost(page, NOT_POSTED);
    await gotoOwnObservation(page, {
      observer: { did: "did:plc:someoneelse", handle: "other.test" },
    });

    await expect(page.getByText("Coordinates")).toBeVisible();
    await expect(postButton(page)).toHaveCount(0);
    await expect(alsoRecordedOn(page)).toHaveCount(0);
  });

  test("the menu has no iNaturalist item", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    await mockCrosspost(page, NOT_POSTED);
    await gotoOwnObservation(page);

    await page.getByLabel("More options").first().click();
    await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /iNaturalist/ })).toHaveCount(0);
  });
});
