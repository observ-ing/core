import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
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

/**
 * An iPhone-style HEIC carrying GPS 37°46'30"N 122°25'6"W and a capture date of
 * 2024:05:17 08:42:10. Chromium can't decode HEIC, so it goes to the server.
 */
const heicPhoto = (name: string) => ({
  name,
  mimeType: "image/heic",
  buffer: readFileSync(join(import.meta.dirname, "../src/lib/testdata/exif-gps.heic")),
});

/** Answer HEIC conversions with a JPEG, or fail them with `status`. */
async function mockHeicConversion(page: Page, status = 200) {
  await page.route("**/api/media/heic-to-jpeg", (route) =>
    status === 200
      ? route.fulfill({ status, contentType: "image/jpeg", body: barePhoto("x.jpg").buffer })
      : route.fulfill({ status, contentType: "application/json", body: "{}" }),
  );
}

const editor = (page: Page) => page.getByRole("complementary", { name: /Edit selected/ });

/** Drop files from outside the page onto `target`, as a drag from the file manager would. */
async function dropFiles(
  page: Page,
  target: Locator,
  files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
) {
  const dataTransfer = await page.evaluateHandle(
    (items) => {
      const transfer = new DataTransfer();
      for (const item of items) {
        const bytes = Uint8Array.from(atob(item.base64), (c) => c.charCodeAt(0));
        transfer.items.add(new File([bytes], item.name, { type: item.mimeType }));
      }
      return transfer;
    },
    files.map((f) => ({ name: f.name, mimeType: f.mimeType, base64: f.buffer.toString("base64") })),
  );
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
}

test.describe("Batch upload - logged out", () => {
  test("is not offered", async ({ page }) => {
    await page.goto("/explore");
    await expect(page.getByRole("link", { name: "Explore" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Batch upload" })).toHaveCount(0);
  });
});

test.describe("Batch upload", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await mockTaxaSearchRoute(page);
  });

  test("is reachable from the create menu", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    // It lives behind the "Add observation" split button's arrow, not in the
    // top bar's nav links.
    await expect(page.getByRole("link", { name: "Explore" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Batch upload" })).toHaveCount(0);

    await page.getByRole("button", { name: "More create options" }).click();
    for (const label of ["Live ID", "Batch upload"]) {
      await expect(page.getByRole("menuitem", { name: label })).toBeVisible();
    }
    await page.getByRole("menuitem", { name: "Batch upload" }).click();
    await expect(page).toHaveURL(BATCH_URL);
    await expect(page.getByRole("heading", { name: "Drag photos here" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  test("reads date, location, and accuracy from each photo's EXIF", async ({
    authenticatedPage: page,
  }) => {
    const bodies = await mockSubmit(page);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("IMG_1.jpg")]);

    const card = cards(page).first();
    // Truncated text carries its full value for hover.
    await expect(card.getByTitle("IMG_1.jpg")).toBeVisible();
    await expect(card).toContainText("Oct 3, 2026");
    await expect(card).toContainText("37.905");
    await expect(card).toContainText("-122.2445");

    await card.getByText("No identification").click();
    await expect(editor(page)).toContainText("UTC-07:00");
    await expect(editor(page)).toContainText("Coordinate Uncertainty: 12m");

    await page.getByRole("button", { name: "Upload 1 observation" }).click();
    await expect(page).toHaveURL(/\/profile\//);
    expect(bodies).toHaveLength(1);
    // 10:42 at UTC-7, whatever zone the browser is in.
    expect(bodies[0]).toMatchObject({
      eventDate: "2026-10-03T17:42:00.000Z",
      coordinateUncertaintyInMeters: 12,
    });
    expect(bodies[0]?.["images"]).toHaveLength(1);
  });

  test("blocks upload until every observation has a date and a location", async ({
    authenticatedPage: page,
  }) => {
    const bodies = await mockSubmit(page);
    await page.goto(BATCH_URL);
    await addPhotos(page, [barePhoto("a.jpg"), barePhoto("b.jpg")]);

    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).first()).toContainText("Missing date and location");
    await expect(page.getByRole("button", { name: "2 incomplete" })).toBeVisible();
    const upload = page.getByRole("button", { name: "Upload 2 observations" });
    await expect(upload).toBeDisabled();

    // Edit both at once.
    await page.getByRole("button", { name: "Select all" }).click();
    await expect(editor(page)).toContainText("Editing 2 observations");
    await page.getByLabel("Observation date").fill("2026-10-04T08:15");
    await page.getByRole("button", { name: "Enter coordinates manually" }).click();
    await page.getByLabel("Latitude").fill("37.9");
    await page.getByLabel("Longitude").fill("-122.2");
    await page.getByRole("button", { name: "Set location for 2 observations" }).click();
    await page.getByLabel("Remarks").fill("creek trail");

    await expect(page.getByRole("button", { name: /incomplete/ })).toHaveCount(0);
    await upload.click();
    await expect(page).toHaveURL(/\/profile\//);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).toMatchObject({
        latitude: 37.9,
        longitude: -122.2,
        coordinateUncertaintyInMeters: 50,
        occurrenceRemarks: "creek trail",
      });
    }
  });

  test("sets one coordinate uncertainty on several observations at once", async ({
    authenticatedPage: page,
  }) => {
    const bodies = await mockSubmit(page);
    await page.goto(BATCH_URL);
    // 12 m from the first photo's EXIF, the 50 m default for the second.
    await addPhotos(page, [taggedPhoto("a.jpg"), barePhoto("b.jpg")]);
    await expect(cards(page)).toHaveCount(2);

    await page.getByRole("button", { name: "Select all" }).click();
    await expect(editor(page)).toContainText("Coordinate Uncertainty: Mixed values");
    const slider = page.getByRole("slider", { name: "Coordinate uncertainty" });
    await slider.focus();
    await slider.press("Home");
    await expect(editor(page)).toContainText("Coordinate Uncertainty: 1m");

    // Setting a location for both afterwards keeps the uncertainty just chosen.
    // (The two are in different time zones, so that comes before the date.)
    await page.getByLabel("Time zone").click();
    await page.getByRole("option", { name: "UTC-07:00", exact: true }).click();
    await page.getByLabel("Observation date").fill("2026-10-04T08:15");
    await page.getByRole("button", { name: "Enter coordinates manually" }).click();
    await page.getByLabel("Latitude").fill("37.9");
    await page.getByLabel("Longitude").fill("-122.2");
    await page.getByRole("button", { name: "Set location for 2 observations" }).click();

    await page.getByRole("button", { name: "Upload 2 observations" }).click();
    await expect(page).toHaveURL(/\/profile\//);
    expect(bodies.map((b) => b["coordinateUncertaintyInMeters"])).toEqual([1, 1]);
  });

  test("observations in different time zones need one zone before their date can be edited", async ({
    authenticatedPage: page,
  }) => {
    const bodies = await mockSubmit(page);
    await page.goto(BATCH_URL);
    // The first photo was taken at UTC-7; the second records no zone.
    await addPhotos(page, [taggedPhoto("a.jpg"), barePhoto("b.jpg")]);
    await expect(cards(page)).toHaveCount(2);

    await page.getByRole("button", { name: "Select all" }).click();
    const date = page.getByLabel("Observation date");
    await expect(date).toBeDisabled();
    await expect(editor(page)).toContainText("different time zones");

    await page.getByLabel("Time zone").click();
    await page.getByRole("option", { name: "UTC-07:00", exact: true }).click();
    await expect(date).toBeEnabled();
    await date.fill("2026-10-04T08:15");

    await page.getByRole("button", { name: "Enter coordinates manually" }).click();
    await page.getByLabel("Latitude").fill("37.9");
    await page.getByLabel("Longitude").fill("-122.2");
    await page.getByRole("button", { name: "Set location for 2 observations" }).click();
    await page.getByRole("button", { name: "Upload 2 observations" }).click();
    await expect(page).toHaveURL(/\/profile\//);

    // 08:15 at UTC-7 for both, whatever zone the browser is in.
    expect(bodies.map((b) => b["eventDate"])).toEqual([
      "2026-10-04T15:15:00.000Z",
      "2026-10-04T15:15:00.000Z",
    ]);
  });

  test("lists skipped files and adds the rest", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [
      barePhoto("ok.jpg"),
      { name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") },
    ]);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("1 file wasn't added");
    await expect(dialog).toContainText("notes.pdf");
    await expect(dialog).toContainText("Not a JPEG, PNG, WebP, or HEIC");
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(cards(page)).toHaveCount(1);
  });

  test("swaps the drop area for a toolbar button once photos are added", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await expect(page.getByRole("heading", { name: "Drag photos here" })).toBeVisible();

    await addPhotos(page, [barePhoto("a.jpg")]);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Drag photos here" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Browse files" })).toHaveCount(0);

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add photos" }).click();
    await (await chooser).setFiles([barePhoto("b.jpg")]);
    await expect(cards(page)).toHaveCount(2);
  });

  test("converts HEIC photos to JPEG, keeping their EXIF", async ({ authenticatedPage: page }) => {
    await mockHeicConversion(page);
    await page.goto(BATCH_URL);
    await addPhotos(page, [heicPhoto("IMG_0001.HEIC")]);

    const card = cards(page).first();
    await expect(card.getByTitle("IMG_0001.jpg")).toBeVisible();
    await expect(card).toContainText("May 17, 2024");
    await expect(card).toContainText("37.775");
    await expect(card).toContainText("-122.418333");
  });

  test("lists a HEIC photo that couldn't be converted as skipped", async ({
    authenticatedPage: page,
  }) => {
    await mockHeicConversion(page, 503);
    await page.goto(BATCH_URL);
    await addPhotos(page, [barePhoto("ok.jpg"), heicPhoto("IMG_0002.HEIC")]);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("1 file wasn't added");
    await expect(dialog).toContainText("IMG_0002.HEIC");
    await expect(dialog).toContainText("Couldn't convert from HEIC");
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(cards(page)).toHaveCount(1);
  });

  test("clicking the page background clears the selection", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);
    await cards(page).first().getByText("No identification").click();
    await expect(editor(page)).toContainText("Editing 1 observation");

    // Working in the editor keeps the selection.
    await page.getByLabel("Remarks").fill("kept");
    await editor(page).getByText("Editing 1 observation").click();
    await expect(editor(page)).toContainText("Editing 1 observation");

    // A drag that starts in the editor (panning its map, selecting text) and
    // ends over the background is not a background click.
    const title = page.getByRole("heading", { name: "Batch upload" });
    await editor(page).getByText("Editing 1 observation").hover();
    await page.mouse.down();
    await title.hover();
    await page.mouse.up();
    await expect(editor(page)).toContainText("Editing 1 observation");

    await title.click();
    await expect(editor(page)).toContainText("Nothing selected");
    await expect(cards(page).first()).toContainText("kept");
  });

  test("drawing a rectangle from the background selects the cards it touches", async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg"), taggedPhoto("c.jpg")]);
    await expect(cards(page)).toHaveCount(3);

    // From the title, above and left of the grid, to the middle of the second
    // card: touches the first two cards and stops short of the third.
    const start = await page.getByRole("heading", { name: "Batch upload" }).boundingBox();
    const second = await cards(page).nth(1).boundingBox();
    if (!start || !second) throw new Error("layout not ready");
    await page.mouse.move(start.x + 5, start.y + 5);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2, {
      steps: 5,
    });
    // Cards show the selection while the rectangle is still being drawn.
    await expect(cards(page).nth(1).getByRole("checkbox")).toBeChecked();
    await expect(editor(page)).toContainText("Nothing selected");
    await page.mouse.up();

    await expect(editor(page)).toContainText("Editing 2 observations");
    await expect(cards(page).nth(0).getByRole("checkbox")).toBeChecked();
    await expect(cards(page).nth(1).getByRole("checkbox")).toBeChecked();
    await expect(cards(page).nth(2).getByRole("checkbox")).not.toBeChecked();
  });

  test("a rectangle held at the bottom edge scrolls the grid and keeps selecting", async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 700 });
    await page.goto(BATCH_URL);
    await addPhotos(
      page,
      Array.from({ length: 12 }, (_, i) => taggedPhoto(`p${i}.jpg`)),
    );
    await expect(cards(page)).toHaveCount(12);
    await expect(cards(page).last()).not.toBeInViewport();

    const start = await page.getByRole("heading", { name: "Batch upload" }).boundingBox();
    const grid = await page.getByRole("region", { name: "Observations" }).boundingBox();
    if (!start || !grid) throw new Error("layout not ready");
    await page.mouse.move(start.x + 5, start.y + 5);
    await page.mouse.down();
    // To the bottom-right corner of the grid, and hold there.
    await page.mouse.move(grid.x + grid.width - 10, grid.y + grid.height - 5, { steps: 5 });
    await expect(page.getByText("12 selected")).toBeVisible();
    await page.mouse.up();

    await expect(editor(page)).toContainText("Editing 12 observations");
    await expect(cards(page).last()).toBeInViewport();
  });

  test("a card's remove button removes only that card", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg"), taggedPhoto("c.jpg")]);
    await cards(page).nth(0).getByText("No identification").click();
    await expect(editor(page)).toContainText("Editing 1 observation");

    await cards(page).nth(1).getByRole("button", { name: "Remove observation" }).click();

    await expect(cards(page)).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Photo b.jpg" })).toHaveCount(0);
    // The selection on another card is untouched.
    await expect(editor(page)).toContainText("Editing 1 observation");
    await expect(cards(page).nth(0).getByRole("checkbox")).toBeChecked();
  });

  test("combines and splits with the toolbar", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg"), taggedPhoto("c.jpg")]);
    await expect(cards(page)).toHaveCount(3);

    await expect(page.getByRole("button", { name: "Combine" })).toBeDisabled();
    await page.getByRole("button", { name: "Select all" }).click();
    await page.getByRole("button", { name: "Combine" }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText("3 photos");

    // The space beside the extra photos selects the card, and a thumbnail
    // toggles it once, not twice.
    await page.getByRole("button", { name: "Clear" }).click();
    const strip = cards(page).first().getByRole("button", { name: "Photo c.jpg" }).locator("../..");
    const box = await strip.boundingBox();
    if (!box) throw new Error("layout not ready");
    await strip.click({ position: { x: box.width - 10, y: box.height / 2 } });
    await expect(cards(page).first().getByRole("checkbox")).toBeChecked();
    await cards(page)
      .first()
      .getByRole("button", { name: "Photo c.jpg" })
      .click({
        modifiers: ["Shift"],
      });
    await expect(cards(page).first().getByRole("checkbox")).not.toBeChecked();
    await cards(page).first().getByRole("button", { name: "Photo c.jpg" }).click();

    await page.getByRole("button", { name: "Split photos" }).click();
    await expect(cards(page)).toHaveCount(3);
  });

  test("dragging one card onto another combines them", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);
    await expect(cards(page)).toHaveCount(2);

    await cards(page)
      .nth(1)
      .getByText("No identification")
      .dragTo(cards(page).first().getByText("No identification"));

    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText("2 photos");
  });

  test("files dropped on a card join it; files dropped elsewhere start new observations", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    await expect(cards(page)).toHaveCount(1);

    await dropFiles(page, cards(page).first(), [barePhoto("b.jpg"), barePhoto("c.jpg")]);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText("3 photos");
    // The card keeps what it already had.
    await expect(cards(page).first()).toContainText("Oct 3, 2026");

    await dropFiles(page, page.getByRole("heading", { name: "Batch upload" }), [
      barePhoto("d.jpg"),
    ]);
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).nth(1)).toContainText("Missing date");
  });

  test("refuses files that would put more than 10 photos on a card", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    await expect(cards(page)).toHaveCount(1);

    const tooMany = Array.from({ length: 10 }, (_, i) => barePhoto(`x${i}.jpg`));
    await dropFiles(page, cards(page).first(), tooMany);

    await expect(page.getByText("An observation holds up to 10 photos")).toBeVisible();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).not.toContainText("photos");
  });

  test("dragging a photo within its card reorders it, and out of the card splits it off", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), barePhoto("b.jpg"), taggedPhoto("c.jpg")]);
    await page.getByRole("button", { name: "Select all" }).click();
    await page.getByRole("button", { name: "Combine" }).click();
    const card = cards(page).first();
    await expect(card).toContainText("3 photos");

    // Onto the left half of the cover: c.jpg becomes the cover.
    await card
      .getByRole("button", { name: "Photo c.jpg" })
      .dragTo(card.getByRole("button", { name: "Photo a.jpg" }), {
        targetPosition: { x: 20, y: 120 },
      });
    await expect(card.getByRole("button", { name: /^Photo / }).first()).toHaveAccessibleName(
      "Photo c.jpg",
    );
    await expect(cards(page)).toHaveCount(1);

    // Out of the card, anywhere off one: b.jpg starts over from its own (empty) EXIF.
    await card
      .getByRole("button", { name: "Photo b.jpg" })
      .dragTo(page.getByRole("heading", { name: "Batch upload" }));
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).first()).toContainText("2 photos");
    await expect(cards(page).nth(1)).toContainText("Missing date and location");
  });

  test("uploaded cards hold their place until the run finishes", async ({
    authenticatedPage: page,
  }) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockSubmit(page, [], gate);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);
    await cards(page).nth(1).getByText("No identification").click();
    await page.getByLabel("Remarks").fill("slow");
    await page.getByRole("button", { name: "Upload 2 observations" }).click();

    await expect(cards(page).first()).toContainText("Uploaded");
    await expect(cards(page).nth(1)).toContainText("Uploading");
    await expect(cards(page)).toHaveCount(2);
    await expect(page.getByText("1 of 2 uploaded")).toBeVisible();

    release();
    await expect(page).toHaveURL(/\/profile\//);
  });

  test("keeps failed observations for a retry and drops uploaded ones", async ({
    authenticatedPage: page,
  }) => {
    const bodies = await mockSubmit(page, ["fails"]);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);
    await expect(cards(page)).toHaveCount(2);

    await cards(page).nth(1).getByText("No identification").click();
    await page.getByLabel("Remarks").fill("fails");
    await page.getByRole("button", { name: "Upload 2 observations" }).click();

    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText("Upload failed");
    await expect(cards(page).first()).toContainText("PDS unavailable");
    await expect(page.getByText("1 of 2 uploaded")).toBeVisible();
    await expect(page.getByRole("link", { name: /View the 1 uploaded/ })).toBeVisible();
    await expect(page).toHaveURL(BATCH_URL);

    // Fix it and retry from the card.
    await cards(page).first().getByText("No identification").click();
    await page.getByLabel("Remarks").fill("fixed");
    await cards(page).first().getByRole("button", { name: "Retry" }).click();

    await expect(page).toHaveURL(/\/profile\//);
    expect(bodies).toHaveLength(2);
  });

  test("confirms before leaving with unsent photos", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    await expect(cards(page)).toHaveCount(1);

    await page.getByRole("link", { name: "Explore" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Leave batch upload?");
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(BATCH_URL);
    await expect(cards(page)).toHaveCount(1);

    await page.getByRole("link", { name: "Explore" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
    await expect(page).toHaveURL("/explore");
  });

  test("leaving mid-upload sends nothing that was still queued", async ({
    authenticatedPage: page,
  }) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bodies = await mockSubmit(page, [], gate);
    await page.goto(BATCH_URL);
    // One more than the uploader sends at once, so one waits its turn.
    await addPhotos(
      page,
      ["a", "b", "c", "d"].map((name) => taggedPhoto(`${name}.jpg`)),
    );
    await expect(cards(page)).toHaveCount(4);
    await page.getByRole("button", { name: "Select all" }).click();
    await page.getByLabel("Remarks").fill("slow");
    await page.getByRole("button", { name: "Upload 4 observations" }).click();
    await expect(page.getByText("Queued", { exact: true })).toHaveCount(1);

    await page.getByRole("link", { name: "Explore" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
    await expect(page).toHaveURL("/explore");
    // The address changes first; the page itself goes once the next one is ready.
    await expect(page.getByRole("heading", { name: "Batch upload" })).toHaveCount(0);

    release();
    await expect.poll(() => bodies.length).toBe(3);
    // Long enough for a fourth request to go out, if one were coming.
    await page.waitForTimeout(500);
    expect(bodies).toHaveLength(3);
  });

  test("logging out with photos held does not trap navigation", async ({
    authenticatedPage: page,
  }) => {
    await page.route("**/oauth/logout", (route) => route.fulfill({ status: 200, body: "" }));
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    await expect(cards(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page.getByText("Log in to upload observations.")).toBeVisible();

    await page.getByRole("link", { name: "Explore" }).click();
    await expect(page).toHaveURL("/explore");
  });

  test("the incomplete filter never leaves a hidden card selected", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("ok.jpg"), barePhoto("a.jpg"), barePhoto("b.jpg")]);
    await expect(cards(page)).toHaveCount(3);

    // Turning the filter on takes the complete card out of the selection too.
    await page.getByRole("button", { name: "Select all" }).click();
    await expect(editor(page)).toContainText("Editing 3 observations");
    await page.getByRole("button", { name: "2 incomplete" }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect(editor(page)).toContainText("Editing 2 observations");

    // A card completed while selected stays in view for as long as it is selected.
    await cards(page).first().getByText("No identification").click();
    await page.getByLabel("Observation date").fill("2026-10-04T08:15");
    await page.getByRole("button", { name: "Enter coordinates manually" }).click();
    await page.getByLabel("Latitude").fill("37.9");
    await page.getByLabel("Longitude").fill("-122.2");
    await expect(cards(page).first()).toContainText("37.9");
    await expect(cards(page)).toHaveCount(2);
    await expect(editor(page)).toContainText("Editing 1 observation");

    await cards(page).nth(1).getByText("No identification").click();
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Photo a.jpg" })).toHaveCount(0);
  });

  test("a failed observation edited into an incomplete one cannot be retried", async ({
    authenticatedPage: page,
  }) => {
    await mockSubmit(page, ["fails"]);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    const card = cards(page).first();
    await card.getByText("No identification").click();
    await page.getByLabel("Remarks").fill("fails");
    await page.getByRole("button", { name: "Upload 1 observation" }).click();
    await expect(card).toContainText("Upload failed");
    await expect(card.getByRole("button", { name: "Retry" })).toBeEnabled();

    await card.getByText("No identification").click();
    await page.getByLabel("Observation date").fill("");
    await expect(card).toContainText("Missing date");
    await expect(card.getByRole("button", { name: "Retry" })).toBeDisabled();
  });

  test("waits for the saved default license before uploading", async ({
    authenticatedPage: page,
  }) => {
    const cc0 = "https://creativecommons.org/publicdomain/zero/1.0/";
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/user/preferences", async (route) => {
      await gate;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ defaultLicense: cc0, basemap: null }),
      });
    });
    const bodies = await mockSubmit(page);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    // The photo has been read, so nothing else is holding the upload back.
    await expect(cards(page).first()).toContainText("Oct 3, 2026");
    const upload = page.getByRole("button", { name: "Upload 1 observation" });
    await expect(upload).toBeDisabled();

    release();
    await upload.click();
    await expect(page).toHaveURL(/\/profile\//);
    expect(bodies[0]).toMatchObject({ license: cc0 });
  });

  test("visual ID starts over when a different photo becomes the cover", async ({
    authenticatedPage: page,
  }) => {
    await page.route("**/api/species-id/status*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ready: true }),
      }),
    );
    await page.route("**/api/species-id", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          suggestions: [{ scientificName: "Quercus robur", confidence: 0.9 }],
          modelVersion: "test",
          inferenceTimeMs: 1,
        }),
      }),
    );
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);
    await page.getByRole("button", { name: "Select all" }).click();
    await page.getByRole("button", { name: "Combine" }).click();
    const card = cards(page).first();
    await expect(card).toContainText("2 photos");

    await editor(page).getByRole("button", { name: "Visual ID" }).click();
    await expect(editor(page).getByText("Quercus robur")).toBeVisible();

    // Onto the left half of the cover: b.jpg becomes the cover.
    await card
      .getByRole("button", { name: "Photo b.jpg" })
      .dragTo(card.getByRole("button", { name: "Photo a.jpg" }), {
        targetPosition: { x: 20, y: 120 },
      });
    await expect(card.getByRole("button", { name: /^Photo / }).first()).toHaveAccessibleName(
      "Photo b.jpg",
    );
    // Those suggestions were for a.jpg.
    await expect(editor(page).getByText("Quercus robur")).toHaveCount(0);
    await expect(editor(page).getByRole("button", { name: "Visual ID" })).toBeVisible();
  });

  test("a press whose release never arrives does not turn into a rectangle", async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);
    await expect(cards(page)).toHaveCount(2);

    // A press alone, as when a context menu or a native drag swallows the
    // mouseup; the pointer then moves with no button held.
    const title = page.getByRole("heading", { name: "Batch upload" });
    const start = await title.boundingBox();
    const second = await cards(page).nth(1).boundingBox();
    if (!start || !second) throw new Error("layout not ready");
    await page.mouse.move(start.x + 5, start.y + 5);
    await title.dispatchEvent("mousedown", {
      button: 0,
      clientX: start.x + 5,
      clientY: start.y + 5,
    });
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2, {
      steps: 5,
    });

    await expect(page.getByText("Drag cards together to combine them")).toBeVisible();
    await expect(cards(page).nth(1).getByRole("checkbox")).not.toBeChecked();
  });

  test("the skipped-files summary keeps its wording while it closes", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [
      barePhoto("ok.jpg"),
      { name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") },
    ]);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("1 file wasn't added");

    await dialog.getByRole("button", { name: "OK" }).click();
    // Checked at once, while it is still fading out.
    expect(await page.getByText("0 files weren't added").count()).toBe(0);
    await expect(dialog).toHaveCount(0);
  });

  test("counts only the files in a drag from outside the page", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    const card = cards(page).first();
    await expect(card).toContainText("Oct 3, 2026");

    // A file, plus the text some sources send along with it.
    const fileAndText = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["x"], "b.jpg", { type: "image/jpeg" }));
      transfer.items.add("b.jpg", "text/plain");
      return transfer;
    });
    await card.dispatchEvent("dragover", { dataTransfer: fileAndText });
    await expect(card).toContainText("2 photos, 1 observation");

    // Text alone (a dragged link or selection) is nothing this page can add.
    const textOnly = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add("hello", "text/plain");
      return transfer;
    });
    await card.dispatchEvent("dragover", { dataTransfer: textOnly });
    await expect(card).not.toContainText("1 observation");
  });
});
