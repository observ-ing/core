// The batch uploader on touch devices (#887): the touch rules the
// grid-and-panel layout follows on a tablet.
import type { Page } from "@playwright/test";
import { test as authTest, expect as authExpect } from "./fixtures/mock-auth";
import { mockOwnObservationFeed } from "./helpers/mock-observation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";
import { BATCH_URL, addPhotos, barePhoto, cards, taggedPhoto } from "./helpers/batch-upload";

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
