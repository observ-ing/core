import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/mock-auth";
import { LINKED, UNLINKED, mockAccount } from "./helpers/inat";
import { gotoUploadStep, openUploadModal } from "./helpers/navigation";
import { BATCH_URL, addPhotos, cards, mockSubmit, taggedPhoto } from "./helpers/batch-upload";
import type { UserPreferencesResponse } from "../src/bindings/UserPreferencesResponse";

// Posting new observations to iNaturalist as they are uploaded (#998). These
// tests never reach iNaturalist: the server queues the cross-post, and every
// /api/inat/* call is mocked.

const UNSET: UserPreferencesResponse = {
  defaultLicense: null,
  basemap: null,
  crosspostInaturalist: null,
  crosspostInaturalistRequirePhotos: null,
};
const AUTO_POST: UserPreferencesResponse = { ...UNSET, crosspostInaturalist: true };

/** Answer GET /api/user/preferences with `prefs`, recording each PUT body. */
async function mockPreferences(page: Page, prefs: UserPreferencesResponse) {
  const puts: Array<Record<string, unknown>> = [];
  await page.route("**/api/user/preferences", (route) => {
    if (route.request().method() === "PUT") {
      puts.push(route.request().postDataJSON());
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: prefs });
  });
  return puts;
}

const checkbox = (page: Page) => page.getByRole("checkbox", { name: "Also post to iNaturalist" });

async function openModalWithPhoto(page: Page) {
  await page.goto("/");
  await openUploadModal(page);
  await page
    .getByRole("dialog")
    .locator('input[type="file"]')
    .setInputFiles(taggedPhoto("IMG_1.jpg"));
  await gotoUploadStep(page, "Date & details");
}

test.describe("iNaturalist - Post new observations from the upload form", () => {
  test("posts by default when the user turned that on", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    await mockPreferences(page, AUTO_POST);
    const bodies = await mockSubmit(page);
    await openModalWithPhoto(page);

    await expect(checkbox(page)).toBeChecked();
    await page.getByRole("dialog").getByRole("button", { name: "Submit" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ crosspostToInaturalist: true });
  });

  test("sends the user's own choice over the default", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    await mockPreferences(page, AUTO_POST);
    const bodies = await mockSubmit(page);
    await openModalWithPhoto(page);

    await checkbox(page).uncheck();
    await page.getByRole("dialog").getByRole("button", { name: "Submit" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ crosspostToInaturalist: false });
  });

  test("starts unticked until the observation has a photo", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    await mockPreferences(page, AUTO_POST);
    await page.goto("/");
    await openUploadModal(page);
    await gotoUploadStep(page, "Date & details");

    await expect(checkbox(page)).not.toBeChecked();
    await page
      .getByRole("dialog")
      .locator('input[type="file"]')
      .setInputFiles(taggedPhoto("IMG_1.jpg"));
    await gotoUploadStep(page, "Date & details");
    await expect(checkbox(page)).toBeChecked();
  });

  test("starts unticked when the user never turned posting on", async ({
    authenticatedPage: page,
  }) => {
    await mockAccount(page, LINKED);
    await mockPreferences(page, UNSET);
    await openModalWithPhoto(page);

    await expect(checkbox(page)).not.toBeChecked();
  });

  test("is not posted when it already links to an iNaturalist observation", async ({
    authenticatedPage: page,
  }) => {
    await mockAccount(page, LINKED);
    await mockPreferences(page, AUTO_POST);
    const bodies = await mockSubmit(page);
    await openModalWithPhoto(page);

    await expect(checkbox(page)).toBeChecked();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Link to the record")
      .fill("https://www.inaturalist.org/observations/123456789");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(checkbox(page)).not.toBeChecked();
    await expect(checkbox(page)).toBeDisabled();
    await expect(dialog).toContainText("Already on iNaturalist");
    await dialog.getByRole("button", { name: "Submit" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ crosspostToInaturalist: false });
  });

  test("is not offered without a linked account", async ({ authenticatedPage: page }) => {
    await mockAccount(page, UNLINKED);
    await mockPreferences(page, AUTO_POST);
    const bodies = await mockSubmit(page);
    await openModalWithPhoto(page);

    await expect(page.getByLabel("Observation date")).toBeVisible();
    await expect(checkbox(page)).toHaveCount(0);
    await page.getByRole("dialog").getByRole("button", { name: "Submit" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).not.toHaveProperty("crosspostToInaturalist");
  });
});

test.describe("iNaturalist - Post new observations from the batch uploader", () => {
  const editor = (page: Page) => page.getByRole("complementary", { name: /Edit selected/ });
  const select = (page: Page, index: number) =>
    cards(page).nth(index).getByRole("checkbox", { name: "Select observation" }).check();
  /** Whether each uploaded observation asked to be posted, in no particular order. */
  const posted = (bodies: Array<Record<string, unknown>>) =>
    bodies.map((body) => body["crosspostToInaturalist"]).sort();

  test("posts each observation by default when the user turned that on", async ({
    authenticatedPage: page,
  }) => {
    await mockAccount(page, LINKED);
    await mockPreferences(page, AUTO_POST);
    const bodies = await mockSubmit(page);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("IMG_1.jpg"), taggedPhoto("IMG_2.jpg")]);

    await select(page, 0);
    await expect(checkbox(page)).toBeChecked();
    await page.getByRole("button", { name: "Upload 2 observations" }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(posted(bodies)).toEqual([true, true]);
  });

  test("sends each observation's own choice", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    await mockPreferences(page, AUTO_POST);
    const bodies = await mockSubmit(page);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("IMG_1.jpg"), taggedPhoto("IMG_2.jpg")]);

    await select(page, 0);
    await editor(page).getByRole("checkbox", { name: "Also post to iNaturalist" }).uncheck();
    await page.getByRole("button", { name: "Upload 2 observations" }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(posted(bodies)).toEqual([false, true]);
  });

  test("posts every selected observation when the user ticks the box", async ({
    authenticatedPage: page,
  }) => {
    await mockAccount(page, LINKED);
    await mockPreferences(page, UNSET);
    const bodies = await mockSubmit(page);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("IMG_1.jpg"), taggedPhoto("IMG_2.jpg")]);

    await select(page, 0);
    await select(page, 1);
    await expect(editor(page)).toContainText("Editing 2 observations");
    await expect(checkbox(page)).not.toBeChecked();
    await checkbox(page).check();
    await page.getByRole("button", { name: "Upload 2 observations" }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(posted(bodies)).toEqual([true, true]);
  });

  test("is not offered without a linked account", async ({ authenticatedPage: page }) => {
    await mockAccount(page, UNLINKED);
    await mockPreferences(page, AUTO_POST);
    const bodies = await mockSubmit(page);
    await page.goto(BATCH_URL);
    await addPhotos(page, [taggedPhoto("IMG_1.jpg")]);

    await select(page, 0);
    await expect(editor(page)).toContainText("Editing 1 observation");
    await expect(checkbox(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Upload 1 observation" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).not.toHaveProperty("crosspostToInaturalist");
  });

  test.describe("on a phone", () => {
    test.use({
      contextOptions: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    });

    test("posts the observations the user ticks", async ({ authenticatedPage: page }) => {
      await mockAccount(page, LINKED);
      await mockPreferences(page, UNSET);
      const bodies = await mockSubmit(page);
      await page.goto(BATCH_URL);
      await addPhotos(page, [taggedPhoto("IMG_1.jpg"), taggedPhoto("IMG_2.jpg")]);

      await cards(page)
        .first()
        .getByRole("button", { name: /^Edit / })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("checkbox", { name: "Also post to iNaturalist" }),
      ).not.toBeChecked();
      await dialog.getByRole("checkbox", { name: "Also post to iNaturalist" }).check();
      await dialog.getByRole("button", { name: "Done" }).click();
      await page.getByRole("button", { name: "Upload 2" }).click();
      await expect.poll(() => bodies.length).toBe(2);
      expect(posted(bodies)).toEqual([false, true]);
    });
  });
});

test.describe("iNaturalist - Settings for new observations", () => {
  test("turns posting on, sending only that change", async ({ authenticatedPage: page }) => {
    await mockAccount(page, LINKED);
    const puts = await mockPreferences(page, { ...UNSET, defaultLicense: "CC0-1.0" });
    await page.goto("/settings");

    const requirePhotos = page.getByRole("switch", { name: "Only observations with photos" });
    await expect(requirePhotos).toBeDisabled();
    await expect(requirePhotos).toBeChecked();
    const autoPost = page.getByRole("switch", { name: "Post new observations to iNaturalist" });
    // Not check(): the saved value lands a tick after the click, once the
    // mutation has cancelled any preferences fetch in flight.
    await autoPost.click();

    await expect(autoPost).toBeChecked();
    await expect(requirePhotos).toBeEnabled();
    await expect.poll(() => puts.length).toBe(1);
    // The server leaves what a request omits alone, so the other preferences
    // aren't sent back, as blanks or otherwise.
    expect(puts[0]).toEqual({ crosspostInaturalist: true });
  });
});
