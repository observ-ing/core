import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { test as authTest, expect as authExpect, getTestUser } from "./fixtures/mock-auth";
import { mockOwnObservationFeed } from "./helpers/mock-observation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";
import { exifJpeg } from "./helpers/exif-jpeg";

const BATCH_URL = "/batch-upload";

/** A photo with no EXIF at all: arrives with no date and no location. */
const barePhoto = (name: string) => ({
  name,
  mimeType: "image/jpeg",
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
});

/** A photo taken in Oakland at 10:42 local time, UTC-7, accurate to 12 m. */
const taggedPhoto = (name: string) => ({
  name,
  mimeType: "image/jpeg",
  buffer: exifJpeg({
    dateTimeOriginal: "2026:10:03 10:42:19",
    offsetTimeOriginal: "-07:00",
    latitude: 37.905,
    longitude: -122.2445,
    accuracyMeters: 12,
  }),
});

const cards = (page: Page) => page.getByTestId("batch-card");
const editor = (page: Page) => page.getByRole("complementary", { name: /Edit selected/ });

async function addPhotos(
  page: Page,
  files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
) {
  await page.getByTestId("batch-file-input").setInputFiles(files);
}

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

/** Capture POSTed observations and answer each with a fresh uri. */
async function mockSubmit(page: Page, failNames: string[] = []) {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/occurrences", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    if (failNames.includes(body.occurrenceRemarks)) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "PDS unavailable" }),
      });
    }
    bodies.push(body);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        uri: `at://${getTestUser().did}/bio.lexicons.temp.v0-1.occurrence/batch${bodies.length}`,
        cid: `bafybatch${bodies.length}`,
      }),
    });
  });
  return bodies;
}

test.describe("Batch upload - logged out", () => {
  test("nav has no Batch upload item", async ({ page }) => {
    await page.goto("/explore");
    await expect(page.getByRole("link", { name: "Explore" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Batch upload" })).toHaveCount(0);
  });
});

authTest.describe("Batch upload", () => {
  authTest.beforeEach(async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await mockTaxaSearchRoute(page);
  });

  authTest("is reachable from the top bar", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Batch upload" }).click();
    await authExpect(page).toHaveURL(BATCH_URL);
    await authExpect(page.getByRole("heading", { name: "Drag photos here" })).toBeVisible();
    await authExpect(page.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  authTest(
    "reads date, location, and accuracy from each photo's EXIF",
    async ({ authenticatedPage: page }) => {
      const bodies = await mockSubmit(page);
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("IMG_1.jpg")]);

      const card = cards(page).first();
      // Truncated text carries its full value for hover.
      await authExpect(card.getByTitle("IMG_1.jpg")).toBeVisible();
      await authExpect(card).toContainText("Oct 3, 2026");
      await authExpect(card).toContainText("37.905");
      await authExpect(card).toContainText("-122.2445");

      await card.getByText("No identification").click();
      await authExpect(editor(page)).toContainText("UTC-07:00");
      await authExpect(editor(page)).toContainText("Coordinate Uncertainty: 12m");

      await page.getByRole("button", { name: "Upload 1 observation" }).click();
      await authExpect(page).toHaveURL(/\/profile\//);
      authExpect(bodies).toHaveLength(1);
      // 10:42 at UTC-7, whatever zone the browser is in.
      authExpect(bodies[0]).toMatchObject({
        eventDate: "2026-10-03T17:42:00.000Z",
        coordinateUncertaintyInMeters: 12,
      });
      authExpect(bodies[0]?.["images"]).toHaveLength(1);
    },
  );

  authTest(
    "blocks upload until every observation has a date and a location",
    async ({ authenticatedPage: page }) => {
      const bodies = await mockSubmit(page);
      await page.goto(BATCH_URL);
      await addPhotos(page, [barePhoto("a.jpg"), barePhoto("b.jpg")]);

      await authExpect(cards(page)).toHaveCount(2);
      await authExpect(cards(page).first()).toContainText("Missing date and location");
      await authExpect(page.getByRole("button", { name: "2 incomplete" })).toBeVisible();
      const upload = page.getByRole("button", { name: "Upload 2 observations" });
      await authExpect(upload).toBeDisabled();

      // Edit both at once.
      await page.getByRole("button", { name: "Select all" }).click();
      await authExpect(editor(page)).toContainText("Editing 2 observations");
      await page.getByLabel("Observation date").fill("2026-10-04T08:15");
      await page.getByRole("button", { name: "Enter coordinates manually" }).click();
      await page.getByLabel("Latitude").fill("37.9");
      await page.getByLabel("Longitude").fill("-122.2");
      await page.getByRole("button", { name: "Set location for 2 observations" }).click();
      await page.getByLabel("Remarks").fill("creek trail");

      await authExpect(page.getByRole("button", { name: /incomplete/ })).toHaveCount(0);
      await upload.click();
      await authExpect(page).toHaveURL(/\/profile\//);
      authExpect(bodies).toHaveLength(2);
      for (const body of bodies) {
        authExpect(body).toMatchObject({
          latitude: 37.9,
          longitude: -122.2,
          coordinateUncertaintyInMeters: 50,
          occurrenceRemarks: "creek trail",
        });
      }
    },
  );

  authTest("lists skipped files and adds the rest", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [
      barePhoto("ok.jpg"),
      { name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") },
    ]);

    const dialog = page.getByRole("dialog");
    await authExpect(dialog).toContainText("1 file wasn't added");
    await authExpect(dialog).toContainText("notes.pdf");
    await authExpect(dialog).toContainText("Not a JPEG, PNG, or WebP");
    await dialog.getByRole("button", { name: "OK" }).click();
    await authExpect(cards(page)).toHaveCount(1);
  });

  authTest(
    "clicking the page background clears the selection",
    async ({ authenticatedPage: page }) => {
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);
      await cards(page).first().getByText("No identification").click();
      await authExpect(editor(page)).toContainText("Editing 1 observation");

      // Working in the editor keeps the selection.
      await page.getByLabel("Remarks").fill("kept");
      await editor(page).getByText("Editing 1 observation").click();
      await authExpect(editor(page)).toContainText("Editing 1 observation");

      // A drag that starts in the editor (panning its map, selecting text) and
      // ends over the background is not a background click.
      const title = page.getByRole("heading", { name: "Batch upload" });
      await editor(page).getByText("Editing 1 observation").hover();
      await page.mouse.down();
      await title.hover();
      await page.mouse.up();
      await authExpect(editor(page)).toContainText("Editing 1 observation");

      await title.click();
      await authExpect(editor(page)).toContainText("Nothing selected");
      await authExpect(cards(page).first()).toContainText("kept");
    },
  );

  authTest(
    "drawing a rectangle from the background selects the cards it touches",
    async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg"), taggedPhoto("c.jpg")]);
      await authExpect(cards(page)).toHaveCount(3);

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
      await authExpect(cards(page).nth(1).getByRole("checkbox")).toBeChecked();
      await authExpect(editor(page)).toContainText("Nothing selected");
      await page.mouse.up();

      await authExpect(editor(page)).toContainText("Editing 2 observations");
      await authExpect(cards(page).nth(0).getByRole("checkbox")).toBeChecked();
      await authExpect(cards(page).nth(1).getByRole("checkbox")).toBeChecked();
      await authExpect(cards(page).nth(2).getByRole("checkbox")).not.toBeChecked();
    },
  );

  authTest(
    "a rectangle held at the bottom edge scrolls the grid and keeps selecting",
    async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: 1400, height: 700 });
      await page.goto(BATCH_URL);
      await addPhotos(
        page,
        Array.from({ length: 12 }, (_, i) => taggedPhoto(`p${i}.jpg`)),
      );
      await authExpect(cards(page)).toHaveCount(12);
      await authExpect(cards(page).last()).not.toBeInViewport();

      const start = await page.getByRole("heading", { name: "Batch upload" }).boundingBox();
      const grid = await page.getByRole("region", { name: "Observations" }).boundingBox();
      if (!start || !grid) throw new Error("layout not ready");
      await page.mouse.move(start.x + 5, start.y + 5);
      await page.mouse.down();
      // To the bottom-right corner of the grid, and hold there.
      await page.mouse.move(grid.x + grid.width - 10, grid.y + grid.height - 5, { steps: 5 });
      await authExpect(page.getByText("12 selected")).toBeVisible();
      await page.mouse.up();

      await authExpect(editor(page)).toContainText("Editing 12 observations");
      await authExpect(cards(page).last()).toBeInViewport();
    },
  );

  authTest("a card's remove button removes only that card", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg"), taggedPhoto("c.jpg")]);
    await cards(page).nth(0).getByText("No identification").click();
    await authExpect(editor(page)).toContainText("Editing 1 observation");

    await cards(page).nth(1).getByRole("button", { name: "Remove observation" }).click();

    await authExpect(cards(page)).toHaveCount(2);
    await authExpect(page.getByRole("button", { name: "Photo b.jpg" })).toHaveCount(0);
    // The selection on another card is untouched.
    await authExpect(editor(page)).toContainText("Editing 1 observation");
    await authExpect(cards(page).nth(0).getByRole("checkbox")).toBeChecked();
  });

  authTest("combines and splits with the toolbar", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg"), taggedPhoto("c.jpg")]);
    await authExpect(cards(page)).toHaveCount(3);

    await authExpect(page.getByRole("button", { name: "Combine" })).toBeDisabled();
    await page.getByRole("button", { name: "Select all" }).click();
    await page.getByRole("button", { name: "Combine" }).click();
    await authExpect(cards(page)).toHaveCount(1);
    await authExpect(cards(page).first()).toContainText("3 photos");

    // The space beside the extra photos selects the card, and a thumbnail
    // toggles it once, not twice.
    await page.getByRole("button", { name: "Clear" }).click();
    const strip = cards(page).first().getByRole("button", { name: "Photo c.jpg" }).locator("../..");
    const box = await strip.boundingBox();
    if (!box) throw new Error("layout not ready");
    await strip.click({ position: { x: box.width - 10, y: box.height / 2 } });
    await authExpect(cards(page).first().getByRole("checkbox")).toBeChecked();
    await cards(page)
      .first()
      .getByRole("button", { name: "Photo c.jpg" })
      .click({
        modifiers: ["Shift"],
      });
    await authExpect(cards(page).first().getByRole("checkbox")).not.toBeChecked();
    await cards(page).first().getByRole("button", { name: "Photo c.jpg" }).click();

    await page.getByRole("button", { name: "Split photos" }).click();
    await authExpect(cards(page)).toHaveCount(3);
  });

  authTest("dragging one card onto another combines them", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);
    await authExpect(cards(page)).toHaveCount(2);

    await cards(page)
      .nth(1)
      .getByText("No identification")
      .dragTo(cards(page).first().getByText("No identification"));

    await authExpect(cards(page)).toHaveCount(1);
    await authExpect(cards(page).first()).toContainText("2 photos");
  });

  authTest(
    "files dropped on a card join it; files dropped elsewhere start new observations",
    async ({ authenticatedPage: page }) => {
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("a.jpg")]);
      await authExpect(cards(page)).toHaveCount(1);

      await dropFiles(page, cards(page).first(), [barePhoto("b.jpg"), barePhoto("c.jpg")]);
      await authExpect(cards(page)).toHaveCount(1);
      await authExpect(cards(page).first()).toContainText("3 photos");
      // The card keeps what it already had.
      await authExpect(cards(page).first()).toContainText("Oct 3, 2026");

      await dropFiles(page, page.getByText("Add photos"), [barePhoto("d.jpg")]);
      await authExpect(cards(page)).toHaveCount(2);
      await authExpect(cards(page).nth(1)).toContainText("Missing date");
    },
  );

  authTest(
    "refuses files that would put more than 10 photos on a card",
    async ({ authenticatedPage: page }) => {
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("a.jpg")]);
      await authExpect(cards(page)).toHaveCount(1);

      const tooMany = Array.from({ length: 10 }, (_, i) => barePhoto(`x${i}.jpg`));
      await dropFiles(page, cards(page).first(), tooMany);

      await authExpect(page.getByText("An observation holds up to 10 photos")).toBeVisible();
      await authExpect(cards(page)).toHaveCount(1);
      await authExpect(cards(page).first()).not.toContainText("photos");
    },
  );

  authTest(
    "dragging a photo within its card reorders it, and out of the card splits it off",
    async ({ authenticatedPage: page }) => {
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("a.jpg"), barePhoto("b.jpg"), taggedPhoto("c.jpg")]);
      await page.getByRole("button", { name: "Select all" }).click();
      await page.getByRole("button", { name: "Combine" }).click();
      const card = cards(page).first();
      await authExpect(card).toContainText("3 photos");

      // Onto the left half of the cover: c.jpg becomes the cover.
      await card
        .getByRole("button", { name: "Photo c.jpg" })
        .dragTo(card.getByRole("button", { name: "Photo a.jpg" }), {
          targetPosition: { x: 20, y: 120 },
        });
      await authExpect(card.getByRole("button", { name: /^Photo / }).first()).toHaveAccessibleName(
        "Photo c.jpg",
      );
      await authExpect(cards(page)).toHaveCount(1);

      // Out to the "Add photos" tile: b.jpg starts over from its own (empty) EXIF.
      await card.getByRole("button", { name: "Photo b.jpg" }).dragTo(page.getByText("Add photos"));
      await authExpect(cards(page)).toHaveCount(2);
      await authExpect(cards(page).first()).toContainText("2 photos");
      await authExpect(cards(page).nth(1)).toContainText("Missing date and location");
    },
  );

  authTest(
    "keeps failed observations for a retry and drops uploaded ones",
    async ({ authenticatedPage: page }) => {
      const bodies = await mockSubmit(page, ["fails"]);
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("a.jpg"), taggedPhoto("b.jpg")]);
      await authExpect(cards(page)).toHaveCount(2);

      await cards(page).nth(1).getByText("No identification").click();
      await page.getByLabel("Remarks").fill("fails");
      await page.getByRole("button", { name: "Upload 2 observations" }).click();

      await authExpect(cards(page)).toHaveCount(1);
      await authExpect(cards(page).first()).toContainText("Upload failed");
      await authExpect(cards(page).first()).toContainText("PDS unavailable");
      await authExpect(page.getByText("1 of 2 uploaded")).toBeVisible();
      await authExpect(page.getByRole("link", { name: /View the 1 uploaded/ })).toBeVisible();
      await authExpect(page).toHaveURL(BATCH_URL);

      // Fix it and retry from the card.
      await cards(page).first().getByText("No identification").click();
      await page.getByLabel("Remarks").fill("fixed");
      await cards(page).first().getByRole("button", { name: "Retry" }).click();

      await authExpect(page).toHaveURL(/\/profile\//);
      authExpect(bodies).toHaveLength(2);
    },
  );

  authTest("confirms before leaving with unsent photos", async ({ authenticatedPage: page }) => {
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("a.jpg")]);
    await authExpect(cards(page)).toHaveCount(1);

    await page.getByRole("link", { name: "Explore" }).click();
    const dialog = page.getByRole("dialog");
    await authExpect(dialog).toContainText("Leave batch upload?");
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await authExpect(page).toHaveURL(BATCH_URL);
    await authExpect(cards(page)).toHaveCount(1);

    await page.getByRole("link", { name: "Explore" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
    await authExpect(page).toHaveURL("/explore");
  });
});
