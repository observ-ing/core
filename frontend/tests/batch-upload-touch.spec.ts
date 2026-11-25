// The batch uploader on touch devices (#887): the full-screen phone layout,
// and the touch rules the grid-and-panel layout follows on a tablet.
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/mock-auth";
import { mockOwnObservationFeed } from "./helpers/mock-observation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";
import {
  BATCH_URL,
  addPhotos,
  barePhoto,
  cards,
  mockSubmit,
  taggedPhoto,
} from "./helpers/batch-upload";

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const TABLET = { viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true };

const check = (page: Page, index: number) =>
  cards(page).nth(index).getByRole("checkbox", { name: "Select observation" }).check();
const openCard = (page: Page, index: number) =>
  cards(page)
    .nth(index)
    .getByRole("button", { name: /^Edit / })
    .click();
const row = (page: Page, label: string) =>
  page.getByRole("dialog").getByRole("button", { name: new RegExp(`^${label}`) });
const photoTiles = (page: Page) => page.getByRole("button", { name: /^Photo \d+$/ });
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

test.describe("Batch upload on a phone", () => {
  test.use({ contextOptions: PHONE });

  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await mockTaxaSearchRoute(page);
  });

  test("is offered in the create menu", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Create actions" }).click();
    await page.getByRole("menuitem", { name: "Batch upload" }).click();
    await expect(page).toHaveURL(BATCH_URL);
    await expect(page.getByRole("button", { name: "Choose photos" })).toBeVisible();
    await expect(page.getByText("removes location from photos")).toHaveCount(0);
  });

  test("a file dropped on the page doesn't take the browser away from the batch", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    await expect(cards(page)).toHaveCount(1);
    const claimed = await cards(page)
      .first()
      .evaluate((card) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["x"], "b.jpg", { type: "image/jpeg" }));
        const event = (type: string) =>
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
        return [!card.dispatchEvent(event("dragover")), !card.dispatchEvent(event("drop"))];
      });
    expect(claimed).toEqual([true, true]);
    await expect(cards(page)).toHaveCount(1);
  });

  test("a long press on a card does not open the system's photo menu", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    await expect(cards(page)).toHaveCount(1);
    expect(await suppressesPhotoMenu(page, 0)).toBe(true);
  });

  test("lays the batch out as cards with the actions in a bar at the bottom", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), barePhoto("b.jpg")]);

    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).nth(1)).toContainText("Missing date and location");
    await expect(page.getByText("1 observation needs a date or location")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload 2" })).toBeDisabled();
    // The desktop side panel has no place here.
    await expect(page.getByRole("complementary")).toHaveCount(0);

    await page.getByRole("button", { name: "Incomplete 1" }).click();
    await expect(cards(page)).toHaveCount(1);
    await page.getByRole("button", { name: "All 2" }).click();
    await expect(cards(page)).toHaveCount(2);
  });

  test("tapping a card edits it and its checkbox selects it", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);

    await openCard(page, 1);
    const editor = page.getByRole("dialog");
    await expect(editor.getByRole("heading", { name: "Observation 2 of 2" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);

    await row(page, "Remarks").click();
    await page.getByLabel("Remarks").fill("creek trail");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(row(page, "Remarks")).toContainText("creek trail");

    await editor.getByRole("button", { name: "Previous observation" }).click();
    await expect(editor.getByRole("heading", { name: "Observation 1 of 2" })).toBeVisible();
    await expect(row(page, "Remarks")).toContainText("Add remarks");
    await editor.getByRole("button", { name: "Done" }).click();

    await check(page, 0);
    await expect(page.getByRole("status")).toHaveText("1 selected");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(page.getByRole("button", { name: "Upload 2" })).toBeEnabled();
  });

  test("the back button closes a step, not the page", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    await openCard(page, 0);
    await row(page, "Date and time").click();
    await expect(page.getByLabel("Time zone")).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Observation 1 of 1" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(cards(page)).toHaveCount(1);
    await expect(page).toHaveURL(BATCH_URL);
  });

  test("combines and splits the checked observations", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg"), taggedPhoto("c.jpg")]);

    await check(page, 0);
    await expect(page.getByRole("button", { name: "Combine" })).toBeDisabled();
    await check(page, 2);
    await expect(page.getByText("2 photos in the selection")).toBeVisible();
    await page.getByRole("button", { name: "Combine" }).click();
    await expect(cards(page)).toHaveCount(2);

    await page.getByRole("button", { name: "Split photos" }).click();
    await expect(cards(page)).toHaveCount(3);

    await page.getByRole("button", { name: "Select all" }).click();
    await expect(page.getByRole("status")).toHaveText("3 selected");
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("button", { name: "Choose photos" })).toBeVisible();
  });

  test("edits several observations at once", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), barePhoto("b.jpg"), taggedPhoto("c.jpg")]);
    await check(page, 0);
    await check(page, 1);
    await page.getByRole("button", { name: "Edit", exact: true }).click();

    const editor = page.getByRole("dialog");
    await expect(editor.getByRole("heading", { name: "Editing 2 observations" })).toBeVisible();
    await expect(row(page, "Date and time")).toContainText("Different dates");
    await expect(row(page, "Date and time")).toContainText("1 has no date");
    await expect(editor.getByRole("button", { name: /Manage/ })).toHaveCount(0);

    await row(page, "Identification").click();
    // Suggestions are for one photo.
    await expect(page.getByRole("button", { name: /Suggest from the first photo/ })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Search species or other taxa" }).fill("quercus");
    await page.getByRole("button", { name: /Quercus robur/ }).click();
    await expect(row(page, "Identification")).toContainText("Quercus robur");
    await editor.getByRole("button", { name: "Done" }).click();

    await expect(cards(page).nth(0)).toContainText("Quercus robur");
    await expect(cards(page).nth(1)).toContainText("Quercus robur");
    await expect(cards(page).nth(2)).toContainText("Unidentified");
  });

  test("a name that isn't in the taxonomy asks for a kingdom", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    await openCard(page, 0);
    await row(page, "Identification").click();
    await expect(page.getByRole("button", { name: /Suggest from the first photo/ })).toBeVisible();

    const search = page.getByRole("textbox", { name: "Search species or other taxa" });
    await search.fill("Mystery beetle");
    // Typing replaces the offer of suggestions; clearing brings it back.
    await expect(page.getByRole("button", { name: /Suggest from the first/ })).toHaveCount(0);
    await page.getByRole("button", { name: /Use "Mystery beetle" as a name/ }).click();
    const use = page.getByRole("button", { name: "Use this name" });
    await expect(use).toBeDisabled();
    await page.getByLabel("Kingdom").click();
    await page.getByRole("option", { name: "Animals" }).click();
    await use.click();

    await expect(row(page, "Identification")).toContainText("Mystery beetle");
    await row(page, "Identification").click();
    await page.getByRole("button", { name: "Remove identification" }).click();
    await expect(row(page, "Identification")).toContainText("Unidentified");
  });

  test("sets a location on the full-screen map and steps to the next incomplete one", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [barePhoto("a.jpg"), taggedPhoto("b.jpg"), barePhoto("c.jpg")]);
    await openCard(page, 0);
    await expect(row(page, "Location")).toContainText("Required");

    await row(page, "Location").click();
    const set = page.getByRole("button", { name: "Set location" });
    await expect(set).toBeDisabled();
    await page.getByRole("button", { name: "Enter coordinates manually" }).click();
    await page.getByLabel("Latitude").fill("37.9");
    await page.getByLabel("Longitude").fill("-122.3");
    // Nothing changes until it is confirmed.
    await set.click();
    await expect(row(page, "Location")).toContainText("37.9");

    // The complete observation in between is skipped.
    await page.getByRole("button", { name: "Next (1 left)" }).click();
    await expect(page.getByRole("heading", { name: "Observation 3 of 3" })).toBeVisible();
  });

  test("splits a photo off its observation, and undoes it", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg"), barePhoto("c.jpg")]);
    await check(page, 0);
    await page.getByRole("button", { name: "Select all" }).click();
    await page.getByRole("button", { name: "Combine" }).click();
    await page.getByRole("button", { name: "Clear selection" }).click();
    await openCard(page, 0);
    await page.getByRole("button", { name: "Manage 3" }).click();
    await expect(page.getByText("3 of 10 in this observation")).toBeVisible();

    await photoTiles(page).nth(2).click();
    await expect(page.getByText("1 photo selected")).toBeVisible();
    await page.getByRole("button", { name: "Split off" }).click();

    // It stays on the photos screen and says where the new observation went
    // and what it still needs.
    await expect(photoTiles(page)).toHaveCount(2);
    const notice = page.getByRole("status");
    await expect(notice).toContainText("Split into a new observation");
    await expect(notice).toContainText("Now observation 2 of 2");
    await expect(notice).toContainText("Missing date and location");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(photoTiles(page)).toHaveCount(3);
    await expect(page.getByRole("status")).toHaveCount(0);

    await photoTiles(page).nth(2).click();
    await page.getByRole("button", { name: "Split off" }).click();
    await page.getByRole("button", { name: "Edit it" }).click();
    await expect(page.getByRole("heading", { name: "Observation 2 of 2" })).toBeVisible();
    // Its editor takes the place of the one the photo came from, so back is the batch.
    await page.getByRole("button", { name: "Back to batch" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("removes photos with undo, and the observation with its last photo", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);
    await check(page, 0);
    await check(page, 1);
    await page.getByRole("button", { name: "Combine" }).click();
    await page.getByRole("button", { name: "Clear selection" }).click();
    await openCard(page, 0);
    await page.getByRole("button", { name: "Manage 2" }).click();

    await photoTiles(page).nth(0).click();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("status")).toContainText("1 photo removed");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(photoTiles(page)).toHaveCount(2);

    await photoTiles(page).nth(0).click();
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("button", { name: "OK" }).click();
    await expect(photoTiles(page)).toHaveCount(1);
    // One photo can't be split off, only removed, and it takes the observation along.
    await photoTiles(page).nth(0).click();
    await expect(page.getByRole("button", { name: "Split off" })).toBeDisabled();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("button", { name: "Choose photos" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("dragging a photo reorders it or drops it on a target", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg"), taggedPhoto("c.jpg")]);
    await check(page, 0);
    await page.getByRole("button", { name: "Select all" }).click();
    await page.getByRole("button", { name: "Combine" }).click();
    await page.getByRole("button", { name: "Clear selection" }).click();
    await openCard(page, 0);
    await page.getByRole("button", { name: "Manage 3" }).click();

    const sources = () =>
      photoTiles(page).evaluateAll((tiles) =>
        tiles.map((tile) => tile.querySelector("img")?.getAttribute("src")),
      );
    await expect(photoTiles(page)).toHaveCount(3);
    const [a, b, c] = await sources();

    // Onto the left half of the first photo: in front of it.
    await photoTiles(page)
      .nth(2)
      .dragTo(photoTiles(page).nth(0), { targetPosition: { x: 10, y: 50 } });
    expect(await sources()).toEqual([c, a, b]);

    // While a photo is in the air the bottom bar is two drop targets.
    await photoTiles(page).nth(0).hover();
    await page.mouse.down();
    await photoTiles(page).nth(1).hover();
    await photoTiles(page)
      .nth(1)
      .hover({ position: { x: 20, y: 60 } });
    await expect(page.getByText("Drop at the green bar to reorder")).toBeVisible();
    await page.getByText("Split off", { exact: true }).hover();
    await page.getByText("Split off", { exact: true }).hover({ position: { x: 5, y: 5 } });
    await expect(page.getByText("Release to make a new observation")).toBeVisible();
    await page.mouse.up();

    await expect(photoTiles(page)).toHaveCount(2);
    await expect(page.getByRole("status")).toContainText("Split into a new observation");
  });

  test("moves a checked photo earlier or later without dragging", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg"), taggedPhoto("c.jpg")]);
    await check(page, 0);
    await page.getByRole("button", { name: "Select all" }).click();
    await page.getByRole("button", { name: "Combine" }).click();
    await page.getByRole("button", { name: "Clear selection" }).click();
    await openCard(page, 0);
    await page.getByRole("button", { name: "Manage 3" }).click();

    const sources = () =>
      photoTiles(page).evaluateAll((tiles) =>
        tiles.map((tile) => tile.querySelector("img")?.getAttribute("src")),
      );
    await expect(photoTiles(page)).toHaveCount(3);
    const [a, b, c] = await sources();
    const earlier = page.getByRole("button", { name: "Move earlier" });
    const later = page.getByRole("button", { name: "Move later" });

    await photoTiles(page).nth(0).click();
    await expect(earlier).toBeDisabled();
    await later.click();
    expect(await sources()).toEqual([b, a, c]);
    // The photo stays checked, so it can keep moving.
    await expect(photoTiles(page).nth(1)).toHaveAttribute("aria-pressed", "true");
    await later.click();
    expect(await sources()).toEqual([b, c, a]);
    await expect(later).toBeDisabled();
    await earlier.click();
    expect(await sources()).toEqual([b, a, c]);

    // With two checked there is no one place to move them to.
    await photoTiles(page).nth(0).click();
    await expect(earlier).toBeDisabled();
    await expect(later).toBeDisabled();
  });

  test("uploads as a list, and keeps the ones that fail", async ({ authenticatedPage: page }) => {
    let release = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bodies = await mockSubmit(page, ["broken"], slow);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg"), taggedPhoto("c.jpg")]);
    for (const [index, remarks] of ["slow", "broken", ""].entries()) {
      if (!remarks) continue;
      await openCard(page, index);
      await row(page, "Remarks").click();
      await page.getByLabel("Remarks").fill(remarks);
      await page.getByRole("button", { name: "Done" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
    }

    await page.getByRole("button", { name: "Upload 3" }).click();
    await expect(page.getByRole("heading", { name: "Uploading" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel remaining" })).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    // Uploaded rows leave; the slow one and the failed one are still listed.
    await expect(page.getByTestId("batch-row")).toHaveCount(2);
    release();

    await expect(page.getByRole("heading", { name: "1 observation did not upload" })).toBeVisible();
    await expect(page.getByText("PDS unavailable")).toBeVisible();
    await expect(page.getByRole("link", { name: "View your observations" })).toBeVisible();
    expect(bodies).toHaveLength(2);

    // Edit it into something the server takes, and send it again.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await row(page, "Remarks").click();
    await page.getByLabel("Remarks").fill("fixed");
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Retry all failed" }).click();
    await expect(page).toHaveURL(/\/profile\//);
    expect(bodies).toHaveLength(3);
  });
});

test.describe("Batch upload in an Android browser", () => {
  test.use({
    contextOptions: {
      ...PHONE,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/126.0.0.0 Mobile Safari/537.36",
    },
  });

  test("warns that picked photos lose their location", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto(BATCH_URL);
    await expect(
      page.getByRole("alert").filter({ hasText: "This browser removes location from photos" }),
    ).toBeVisible();
    // There is no public app to send anyone to yet.
    await expect(page.getByText(/\bapp\b/i)).toHaveCount(0);
  });
});

// Firefox on Android only drags with a mouse, so a long press never starts one.
const FIREFOX_ANDROID = (device: "Mobile" | "Tablet") =>
  `Mozilla/5.0 (Android 14; ${device}; rv:131.0) Gecko/131.0 Firefox/131.0`;

test.describe("Batch upload in Firefox on an Android phone", () => {
  test.use({ contextOptions: { ...PHONE, userAgent: FIREFOX_ANDROID("Mobile") } });

  test("does not offer touch and hold", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);
    await check(page, 0);
    await page.getByRole("button", { name: "Select all" }).click();
    await page.getByRole("button", { name: "Combine" }).click();
    await page.getByRole("button", { name: "Clear selection" }).click();
    await openCard(page, 0);
    await page.getByRole("button", { name: "Manage 2" }).click();

    await expect(photoTiles(page)).toHaveCount(2);
    await expect(page.getByText("Tap a photo to select it")).toBeVisible();
    await expect(page.getByText(/touch and hold/i)).toHaveCount(0);
  });
});

test.describe("Batch upload in Firefox on an Android tablet", () => {
  test.use({ contextOptions: { ...TABLET, userAgent: FIREFOX_ANDROID("Tablet") } });

  test("does not offer touch and hold", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);

    await expect(cards(page)).toHaveCount(2);
    await expect(page.getByText("Tap a checkbox to select.")).toBeVisible();
    await expect(page.getByText(/touch and hold/i)).toHaveCount(0);
  });
});

test.describe("Batch upload on a tablet", () => {
  test.use({ contextOptions: TABLET });

  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await mockTaxaSearchRoute(page);
  });

  test("keeps the grid and side panel, and opens the map full screen", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), barePhoto("b.jpg")]);
    const editor = page.getByRole("complementary", { name: /Edit selected/ });
    await expect(editor).toContainText("Touch and hold a card");

    await check(page, 0);
    await check(page, 1);
    await expect(editor.getByRole("heading", { name: "Editing 2 observations" })).toBeVisible();
    await editor.getByRole("button", { name: "Expand map" }).click();

    const map = page.getByRole("dialog", { name: "Set location" });
    await expect(map).toContainText("1 of the 2 selected observations already has a location");
    await map.getByRole("button", { name: "Enter coordinates manually" }).click();
    await map.getByLabel("Latitude").fill("37.9");
    await map.getByLabel("Longitude").fill("-122.3");
    await map.getByRole("button", { name: "Set location for 2 observations" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(cards(page).nth(0)).toContainText("37.9");
    await expect(cards(page).nth(1)).toContainText("37.9");
  });

  test("a location set full screen drops the point picked in the side panel", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), barePhoto("b.jpg")]);
    const editor = page.getByRole("complementary", { name: /Edit selected/ });
    await check(page, 0);
    await check(page, 1);

    await editor.getByRole("button", { name: "Enter coordinates manually" }).click();
    await editor.getByLabel("Latitude").fill("10");
    await editor.getByLabel("Longitude").fill("20");
    const panelSet = editor.getByRole("button", { name: "Set location for 2 observations" });
    await expect(panelSet).toBeVisible();

    await editor.getByRole("button", { name: "Expand map" }).click();
    const map = page.getByRole("dialog", { name: "Set location" });
    await map.getByRole("button", { name: "Enter coordinates manually" }).click();
    await map.getByLabel("Latitude").fill("37.9");
    await map.getByLabel("Longitude").fill("-122.3");
    await map.getByRole("button", { name: "Set location for 2 observations" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(cards(page).nth(1)).toContainText("37.9");
    await expect(panelSet).toHaveCount(0);
  });

  test("a long press on a card does not open the system's photo menu", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    await expect(cards(page)).toHaveCount(1);
    expect(await suppressesPhotoMenu(page, 0)).toBe(true);
  });

  test("the grid and the side panel scroll on their own", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(
      page,
      Array.from({ length: 12 }, (_, i) => taggedPhoto(`${i}.jpg`)),
    );
    await expect(cards(page)).toHaveCount(12);
    await cards(page).last().scrollIntoViewIfNeeded();
    await expect(page.getByRole("complementary", { name: /Edit selected/ })).toBeInViewport();
  });
});
