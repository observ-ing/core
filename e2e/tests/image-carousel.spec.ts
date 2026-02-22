import { test, expect } from "@playwright/test";
import {
  mockObservationDetailRoute,
  mockInteractionsRoute,
} from "../helpers/mock-observation";

const TEST_DID = "did:plc:testuser123";
const TEST_RKEY = "obs456";
const DETAIL_URL = `/observation/${TEST_DID}/${TEST_RKEY}`;

function observationOverrides(imageOverrides: Record<string, any> = {}) {
  return {
    uri: `at://${TEST_DID}/org.observ.ing.occurrence/${TEST_RKEY}`,
    observer: {
      did: TEST_DID,
      handle: "naturalist.bsky.social",
      displayName: "Nature Lover",
    },
    observers: [],
    ...imageOverrides,
  };
}

test.describe("Image Carousel", () => {
  // TC-IMG-001: Main image displayed
  test("main image displayed for observation with images", async ({
    page,
  }) => {
    // Mock image URLs to return a placeholder
    await page.route("**/media/blob/**", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
    });

    await mockObservationDetailRoute(page, observationOverrides({
      images: [`/media/blob/${TEST_DID}/bafyimg1`],
    }));
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    const mainImage = page.locator("img[alt='Quercus alba']");
    await expect(mainImage).toBeVisible({ timeout: 10000 });
  });

  // TC-IMG-002: Multiple thumbnails shown
  test("multiple thumbnails shown when observation has >1 image", async ({
    page,
  }) => {
    await page.route("**/media/blob/**", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
    });

    await mockObservationDetailRoute(page, observationOverrides({
      images: [
        `/media/blob/${TEST_DID}/bafyimg1`,
        `/media/blob/${TEST_DID}/bafyimg2`,
        `/media/blob/${TEST_DID}/bafyimg3`,
      ],
    }));
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    // Thumbnails are rendered as img elements with alt "Photo N"
    await expect(page.locator("img[alt='Photo 1']")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("img[alt='Photo 2']")).toBeVisible();
    await expect(page.locator("img[alt='Photo 3']")).toBeVisible();
  });

  // TC-IMG-003: Clicking thumbnail changes main image
  test("clicking thumbnail changes the main image", async ({ page }) => {
    await page.route("**/media/blob/**", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
    });

    await mockObservationDetailRoute(page, observationOverrides({
      images: [
        `/media/blob/${TEST_DID}/bafyimg1`,
        `/media/blob/${TEST_DID}/bafyimg2`,
      ],
    }));
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(page.locator("img[alt='Photo 1']")).toBeVisible({
      timeout: 10000,
    });

    // Main image initially shows first image
    const mainImage = page.locator("img[alt='Quercus alba']");
    const initialSrc = await mainImage.getAttribute("src");

    // Click the second thumbnail
    await page.locator("img[alt='Photo 2']").click();

    // Main image src should change
    const newSrc = await mainImage.getAttribute("src");
    expect(newSrc).not.toBe(initialSrc);
  });

  // TC-IMG-004: Single image - no thumbnails
  test("single-image observation shows no thumbnails", async ({ page }) => {
    await page.route("**/media/blob/**", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
    });

    await mockObservationDetailRoute(page, observationOverrides({
      images: [`/media/blob/${TEST_DID}/bafyimg1`],
    }));
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    const mainImage = page.locator("img[alt='Quercus alba']");
    await expect(mainImage).toBeVisible({ timeout: 10000 });

    // No thumbnail images should be present (Photo N alts only appear for multi-image)
    await expect(page.locator("img[alt='Photo 1']")).not.toBeVisible();
  });

  // TC-IMG-005: Alt text matches species name
  test("main image alt text matches species name", async ({ page }) => {
    await page.route("**/media/blob/**", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
    });

    await mockObservationDetailRoute(page, observationOverrides({
      images: [`/media/blob/${TEST_DID}/bafyimg1`],
      communityId: "Falco peregrinus",
      effectiveTaxonomy: {
        scientificName: "Falco peregrinus",
        vernacularName: "Peregrine Falcon",
        kingdom: "Animalia",
        taxonRank: "species",
      },
    }));
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(
      page.locator("img[alt='Falco peregrinus']"),
    ).toBeVisible({ timeout: 10000 });
  });
});
