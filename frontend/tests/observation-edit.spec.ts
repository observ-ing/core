import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/mock-auth";
import {
  buildMockObservation,
  mockFeed,
  mockOwnObservationFeed,
  mockObservationDetailRoute,
} from "./helpers/mock-observation";
import { gotoUploadStep, openFirstCard, openFirstCardMenu } from "./helpers/navigation";
import { mockJson } from "./helpers/mock-api";

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
// Firefox on Android only drags with a mouse, so a long press never starts one.
const FIREFOX_ANDROID = "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";

// A 1x1 PNG, for a photo added in the edit form.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Observation Edit - Logged Out", () => {
  test("more menu does not show Edit for non-owned observation", async ({ page }) => {
    await mockOwnObservationFeed(page);
    await mockObservationDetailRoute(page);
    await page.goto("/explore");
    await openFirstCard(page);
    const moreButton = page.getByLabel("More options").first();
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    await expect(page.getByRole("menuitem", { name: "View on AT Protocol" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Edit" })).not.toBeVisible();
  });
});

test.describe("Observation Edit - Logged In", () => {
  test("more menu shows Edit for own observation", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto("/");
    await openFirstCardMenu(page);
    await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  });

  test("more menu hides Edit for others' observations", async ({ authenticatedPage: page }) => {
    // Mock a feed with an observation owned by a different user
    const otherUserObs = buildMockObservation({
      uri: "at://did:plc:otheruser/bio.lexicons.temp.v0-1.occurrence/other123",
      observer: {
        did: "did:plc:otheruser",
        handle: "other.bsky.social",
        displayName: "Other User",
      },
    });
    await mockFeed(page, [otherUserObs]);

    await page.goto("/");
    const moreButton = page.getByLabel("More options").first();
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    await expect(page.getByRole("menuitem", { name: "View on AT Protocol" })).toBeVisible();
    // Edit should not appear for others' observations
    await expect(page.getByRole("menuitem", { name: "Edit" })).not.toBeVisible();
  });

  test("clicking Edit opens upload modal in edit mode", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page, {
      eventDate: "2024-06-15",
    });
    await page.goto("/");
    await openFirstCardMenu(page);
    await page.getByRole("menuitem", { name: "Edit" }).click();

    // Should see "Edit Observation" title
    await expect(page.getByText("Edit Observation")).toBeVisible({ timeout: 5000 });
  });

  test("edit modal pre-populates species", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page, {
      eventDate: "2024-06-15",
    });
    await page.goto("/");
    await openFirstCardMenu(page);
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByText("Edit Observation")).toBeVisible({ timeout: 5000 });

    // Species input lives in the (collapsed) Identify step; reveal it first.
    await gotoUploadStep(page, "Identify");
    const speciesInput = page.getByLabel(/Taxon/i);
    await expect(speciesInput).toHaveValue("Quercus alba");
  });

  test("submitting edit sends PUT request", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page, {
      eventDate: "2024-06-15",
      location: { latitude: 37.7749, longitude: -122.4194 },
    });

    await mockJson(
      page,
      "**/api/occurrences",
      {
        uri: "at://did:plc:test/bio.lexicons.temp.v0-1.occurrence/test123",
        cid: "bafyupdated",
      },
      { method: "PUT" },
    );

    await page.goto("/");
    await openFirstCardMenu(page);
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByText("Edit Observation")).toBeVisible({ timeout: 5000 });

    const putRequest = page.waitForRequest(
      (req) => req.method() === "PUT" && req.url().includes("/api/occurrences"),
    );

    // Click Save Changes
    await page.getByRole("button", { name: "Save Changes" }).click();
    const req = await putRequest;
    expect(req.method()).toBe("PUT");
  });

  test.describe("reordering photos", () => {
    const photo = (page: Page, n: number) =>
      page.getByRole("dialog").getByRole("button", { name: `Enlarge photo ${n}` });

    /** Open the edit form for an observation with photos of these blob CIDs. */
    async function editPhotoObservation(page: Page, blobCids = ["blob-a", "blob-b"]) {
      await mockOwnObservationFeed(page, {
        eventDate: "2024-06-15",
        location: { latitude: 37.7749, longitude: -122.4194 },
        images: blobCids.map((cid) => ({ url: `/media/blob/did:plc:test/${cid}` })),
      });
      await mockJson(
        page,
        "**/api/occurrences",
        {
          uri: "at://did:plc:test/bio.lexicons.temp.v0-1.occurrence/test123",
          cid: "bafyupdated",
        },
        { method: "PUT" },
      );
      await page.goto("/");
      await openFirstCardMenu(page);
      await page.getByRole("menuitem", { name: "Edit" }).click();
      await expect(page.getByText("Edit Observation")).toBeVisible({ timeout: 5000 });
      await expect(photo(page, blobCids.length)).toBeVisible();
    }

    async function addPhoto(page: Page) {
      await page
        .getByRole("dialog")
        .locator('input[type="file"]')
        .setInputFiles({ name: "new.png", mimeType: "image/png", buffer: TINY_PNG });
    }

    // Whether opening the system's menu on photo `n` is prevented.
    const suppressesMenu = (page: Page, n: number) =>
      photo(page, n).evaluate(
        (el) =>
          !el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
      );
    const dragHint = (page: Page) => page.getByText("Drag photos to reorder them.");

    async function savedBody(page: Page) {
      const putRequest = page.waitForRequest(
        (req) => req.method() === "PUT" && req.url().includes("/api/occurrences"),
      );
      await page.getByRole("button", { name: "Save Changes" }).click();
      return (await putRequest).postDataJSON();
    }

    test("dragging a photo saves the new order", async ({ authenticatedPage: page }) => {
      await editPhotoObservation(page);

      // Onto the left half of the first photo: in front of it.
      await photo(page, 2).dragTo(photo(page, 1), { targetPosition: { x: 5, y: 40 } });

      const body = await savedBody(page);
      expect(body.photoOrder).toEqual([{ retained: "blob-b" }, { retained: "blob-a" }]);
    });

    test("a photo added while editing can go in front of the existing ones", async ({
      authenticatedPage: page,
    }) => {
      await editPhotoObservation(page);
      await addPhoto(page);
      await expect(photo(page, 3)).toBeVisible();

      await photo(page, 3).dragTo(photo(page, 1), { targetPosition: { x: 5, y: 40 } });

      const body = await savedBody(page);
      expect(body.images).toHaveLength(1);
      expect(body.photoOrder).toEqual([{ new: 0 }, { retained: "blob-a" }, { retained: "blob-b" }]);
    });

    test("removing a photo leaves it out of the order", async ({ authenticatedPage: page }) => {
      await editPhotoObservation(page);

      await page.getByRole("dialog").getByRole("button", { name: "Remove photo 1" }).click();

      const body = await savedBody(page);
      expect(body.photoOrder).toEqual([{ retained: "blob-b" }]);
      // Also sent for a server without `photoOrder`, which would otherwise
      // read its absence as keeping no photos at all.
      expect(body.retainedBlobCids).toEqual(["blob-b"]);
    });

    test("removing one of two copies of a photo keeps the other", async ({
      authenticatedPage: page,
    }) => {
      // The same photo added twice: two media records holding one blob.
      await editPhotoObservation(page, ["blob-a", "blob-a"]);

      await page.getByRole("dialog").getByRole("button", { name: "Remove photo 1" }).click();

      const body = await savedBody(page);
      expect(body.photoOrder).toEqual([{ retained: "blob-a" }]);
    });

    test("a photo added before the preferences load is kept", async ({
      authenticatedPage: page,
    }) => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/user/preferences", async (route) => {
        await gate;
        return route.fulfill({
          json: {
            defaultLicense: "https://creativecommons.org/publicdomain/zero/1.0/",
            basemap: null,
          },
        });
      });
      await editPhotoObservation(page);
      await addPhoto(page);
      await expect(photo(page, 3)).toBeVisible();
      // On another step, so the photos showing again marks the form having
      // taken the preferences in, which brings it back to the first step.
      await gotoUploadStep(page, "Identify");
      await expect(photo(page, 1)).toBeHidden();

      release();

      await expect(photo(page, 1)).toBeVisible();
      await expect(photo(page, 3)).toBeVisible();
    });

    test("a right-click on a photo opens the browser's menu", async ({
      authenticatedPage: page,
    }) => {
      await editPhotoObservation(page);

      expect(await suppressesMenu(page, 1)).toBe(false);
    });

    test.describe("on a phone", () => {
      test.use({ contextOptions: PHONE });

      test("a long press on a photo is kept from opening the system's menu", async ({
        authenticatedPage: page,
      }) => {
        await editPhotoObservation(page);

        expect(await suppressesMenu(page, 1)).toBe(true);
        await expect(dragHint(page)).toBeVisible();
      });

      // iOS Safari opens its own image menu (Save to Photos, Copy Subject)
      // for a long press that lands on an <img>, instead of starting a drag.
      test("a long press on a photo lands on its tile, not the image", async ({
        authenticatedPage: page,
      }) => {
        await editPhotoObservation(page);

        const target = await photo(page, 1).evaluate((el) => {
          const { left, top, width, height } = el.getBoundingClientRect();
          return document.elementFromPoint(left + width / 2, top + height / 2)?.tagName;
        });
        expect(target).not.toBe("IMG");
      });
    });

    test.describe("in Firefox on an Android phone", () => {
      test.use({ contextOptions: { ...PHONE, userAgent: FIREFOX_ANDROID } });

      test("does not say to drag the photos", async ({ authenticatedPage: page }) => {
        await editPhotoObservation(page);

        await expect(dragHint(page)).toHaveCount(0);
      });
    });
  });
});
