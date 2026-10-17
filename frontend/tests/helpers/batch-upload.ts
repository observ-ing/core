// Shared by the batch uploader's specs: photos to feed it and the routes it posts to.
import type { Page } from "@playwright/test";
import { getTestUser } from "../fixtures/mock-auth";
import { exifJpeg } from "./exif-jpeg";

export const BATCH_URL = "/batch-upload";

/** A photo with no EXIF at all: arrives with no date and no location. */
export const barePhoto = (name: string) => ({
  name,
  mimeType: "image/jpeg",
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
});

/** A photo taken in Oakland at 10:42 local time, UTC-7, accurate to 12 m. */
export const taggedPhoto = (name: string) => ({
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

export const cards = (page: Page) => page.getByTestId("batch-card");

export async function addPhotos(
  page: Page,
  files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
) {
  await page.getByTestId("batch-file-input").setInputFiles(files);
}

/** Capture POSTed observations and answer each with a fresh uri. */
export async function mockSubmit(page: Page, failNames: string[] = [], slow?: Promise<void>) {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/occurrences", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    // An observation remarked "slow" waits for the test to let it through.
    if (body.occurrenceRemarks === "slow") await slow;
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
