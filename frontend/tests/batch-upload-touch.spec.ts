// The batch uploader on touch devices (#887): the full-screen phone layout,
// and the touch rules the grid-and-panel layout follows on a tablet.
import type { Page } from "@playwright/test";
import { test as authTest, expect as authExpect } from "./fixtures/mock-auth";
import { mockOwnObservationFeed } from "./helpers/mock-observation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";
import { BATCH_URL, addPhotos, barePhoto, cards, taggedPhoto } from "./helpers/batch-upload";

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const TABLET = { viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true };

const check = (page: Page, index: number) =>
  cards(page).nth(index).getByRole("checkbox", { name: "Select observation" }).check();
// Whether a long press on the card's photo is kept from opening the system's menu.
const suppressesPhotoMenu = (page: Page, index: number) =>
  cards(page)
    .nth(index)
    .locator("img")
    .first()
    .evaluate(
      (img) =>
        !img.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );

// Firefox on Android only drags with a mouse, so a long press never starts one.
const FIREFOX_ANDROID = (device: "Mobile" | "Tablet") =>
  `Mozilla/5.0 (Android 14; ${device}; rv:131.0) Gecko/131.0 Firefox/131.0`;

authTest.describe("Batch upload on a phone", () => {
  authTest.use({ contextOptions: PHONE });

  authTest.beforeEach(async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await mockTaxaSearchRoute(page);
  });

  authTest(
    "a file dropped on the page doesn't take the browser away from the batch",
    async ({ authenticatedPage: page }) => {
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("a.jpg")]);
      await authExpect(cards(page)).toHaveCount(1);
      const claimed = await cards(page)
        .first()
        .evaluate((card) => {
          const transfer = new DataTransfer();
          transfer.items.add(new File(["x"], "b.jpg", { type: "image/jpeg" }));
          const event = (type: string) =>
            new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
          return [!card.dispatchEvent(event("dragover")), !card.dispatchEvent(event("drop"))];
        });
      authExpect(claimed).toEqual([true, true]);
      await authExpect(cards(page)).toHaveCount(1);
    },
  );

  authTest(
    "a long press on a card does not open the system's photo menu",
    async ({ authenticatedPage: page }) => {
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("a.jpg")]);
      await authExpect(cards(page)).toHaveCount(1);
      authExpect(await suppressesPhotoMenu(page, 0)).toBe(true);
    },
  );

  authTest(
    "lays the batch out as cards with the actions in a bar at the bottom",
    async ({ authenticatedPage: page }) => {
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("a.jpg"), barePhoto("b.jpg")]);

      await authExpect(cards(page)).toHaveCount(2);
      await authExpect(cards(page).nth(1)).toContainText("Missing date and location");
      await authExpect(page.getByText("1 observation needs a date or location")).toBeVisible();
      await authExpect(page.getByRole("button", { name: "Upload 2" })).toBeDisabled();
      // The desktop side panel has no place here.
      await authExpect(page.getByRole("complementary")).toHaveCount(0);

      await page.getByRole("button", { name: "Incomplete 1" }).click();
      await authExpect(cards(page)).toHaveCount(1);
      await page.getByRole("button", { name: "All 2" }).click();
      await authExpect(cards(page)).toHaveCount(2);
    },
  );

  authTest("combines and splits the checked observations", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg"), taggedPhoto("c.jpg")]);

    await check(page, 0);
    await authExpect(page.getByRole("button", { name: "Combine" })).toBeDisabled();
    await check(page, 2);
    await authExpect(page.getByText("2 photos in the selection")).toBeVisible();
    await page.getByRole("button", { name: "Combine" }).click();
    await authExpect(cards(page)).toHaveCount(2);

    await page.getByRole("button", { name: "Split photos" }).click();
    await authExpect(cards(page)).toHaveCount(3);

    await page.getByRole("button", { name: "Select all" }).click();
    await authExpect(page.getByRole("status")).toHaveText("3 selected");
    await page.getByRole("button", { name: "Remove" }).click();
    await authExpect(page.getByRole("button", { name: "Choose photos" })).toBeVisible();
  });
});

authTest.describe("Batch upload in an Android browser", () => {
  authTest.use({
    contextOptions: {
      ...PHONE,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/126.0.0.0 Mobile Safari/537.36",
    },
  });

  authTest("warns that picked photos lose their location", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto(BATCH_URL);
    await authExpect(
      page.getByRole("alert").filter({ hasText: "This browser removes location from photos" }),
    ).toBeVisible();
    // There is no public app to send anyone to yet.
    await authExpect(page.getByText(/\bapp\b/i)).toHaveCount(0);
  });
});

authTest.describe("Batch upload in Firefox on an Android tablet", () => {
  authTest.use({ contextOptions: { ...TABLET, userAgent: FIREFOX_ANDROID("Tablet") } });

  authTest("does not offer touch and hold", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);

    await authExpect(cards(page)).toHaveCount(2);
    await authExpect(page.getByText("Tap a checkbox to select.")).toBeVisible();
    await authExpect(page.getByText(/touch and hold/i)).toHaveCount(0);
  });
});

authTest.describe("Batch upload on a tablet", () => {
  authTest.use({ contextOptions: TABLET });

  authTest.beforeEach(async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await mockTaxaSearchRoute(page);
  });

  authTest(
    "keeps the grid and side panel, and opens the map full screen",
    async ({ authenticatedPage: page }) => {
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("a.jpg"), barePhoto("b.jpg")]);
      const editor = page.getByRole("complementary", { name: /Edit selected/ });
      await authExpect(editor).toContainText("Touch and hold a card");

      await check(page, 0);
      await check(page, 1);
      await authExpect(
        editor.getByRole("heading", { name: "Editing 2 observations" }),
      ).toBeVisible();
      await editor.getByRole("button", { name: "Expand map" }).click();

      const map = page.getByRole("dialog", { name: "Set location" });
      await authExpect(map).toContainText(
        "1 of the 2 selected observations already has a location",
      );
      await map.getByRole("button", { name: "Enter coordinates manually" }).click();
      await map.getByLabel("Latitude").fill("37.9");
      await map.getByLabel("Longitude").fill("-122.3");
      await map.getByRole("button", { name: "Set location for 2 observations" }).click();

      await authExpect(page.getByRole("dialog")).toHaveCount(0);
      await authExpect(cards(page).nth(0)).toContainText("37.9");
      await authExpect(cards(page).nth(1)).toContainText("37.9");
    },
  );

  authTest(
    "a location set full screen drops the point picked in the side panel",
    async ({ authenticatedPage: page }) => {
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("a.jpg"), barePhoto("b.jpg")]);
      const editor = page.getByRole("complementary", { name: /Edit selected/ });
      await check(page, 0);
      await check(page, 1);

      await editor.getByRole("button", { name: "Enter coordinates manually" }).click();
      await editor.getByLabel("Latitude").fill("10");
      await editor.getByLabel("Longitude").fill("20");
      const panelSet = editor.getByRole("button", { name: "Set location for 2 observations" });
      await authExpect(panelSet).toBeVisible();

      await editor.getByRole("button", { name: "Expand map" }).click();
      const map = page.getByRole("dialog", { name: "Set location" });
      await map.getByRole("button", { name: "Enter coordinates manually" }).click();
      await map.getByLabel("Latitude").fill("37.9");
      await map.getByLabel("Longitude").fill("-122.3");
      await map.getByRole("button", { name: "Set location for 2 observations" }).click();

      await authExpect(page.getByRole("dialog")).toHaveCount(0);
      await authExpect(cards(page).nth(1)).toContainText("37.9");
      await authExpect(panelSet).toHaveCount(0);
    },
  );

  authTest(
    "a long press on a card does not open the system's photo menu",
    async ({ authenticatedPage: page }) => {
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("a.jpg")]);
      await authExpect(cards(page)).toHaveCount(1);
      authExpect(await suppressesPhotoMenu(page, 0)).toBe(true);
    },
  );

  authTest(
    "the grid and the side panel scroll on their own",
    async ({ authenticatedPage: page }) => {
      await page.goto(BATCH_URL);
      await addPhotos(
        page,
        Array.from({ length: 12 }, (_, i) => taggedPhoto(`${i}.jpg`)),
      );
      await authExpect(cards(page)).toHaveCount(12);
      await cards(page).last().scrollIntoViewIfNeeded();
      await authExpect(page.getByRole("complementary", { name: /Edit selected/ })).toBeInViewport();
    },
  );
});
