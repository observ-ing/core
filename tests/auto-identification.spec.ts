import { test as authTest, expect as authExpect } from "./fixtures/mock-auth";
import { openUploadModal } from "./helpers/navigation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";
import {
  mockOwnObservationFeed,
  mockObservationDetailRoute,
  mockInteractionsRoute,
  MOCK_OBS_DID,
  MOCK_OBS_RKEY,
} from "./helpers/mock-observation";

const AUTO_ID_RKEY = "autoidtest123";
const AUTO_ID_URI = `at://${MOCK_OBS_DID}/bio.lexicons.temp.v0-1.occurrence/${AUTO_ID_RKEY}`;

authTest.describe("Auto-Identification on Upload", () => {
  // TC-AUTOID-001: Uploading with a species auto-creates the first identification
  authTest(
    "observation uploaded with species shows auto-created identification",
    async ({ authenticatedPage: page }) => {
      await mockOwnObservationFeed(page);
      await mockTaxaSearchRoute(page);

      // Mock POST /api/occurrences to return a known URI
      await page.route("**/api/occurrences", (route) => {
        if (route.request().method() === "POST") {
          return route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({ uri: AUTO_ID_URI, cid: "bafytest" }),
          });
        }
        return route.continue();
      });

      // Mock detail page with an auto-created identification for Quercus alba
      await mockObservationDetailRoute(page, {
        uri: AUTO_ID_URI,
        communityId: "Quercus alba",
        effectiveTaxonomy: {
          scientificName: "Quercus alba",
          vernacularName: "White Oak",
          kingdom: "Plantae",
        },
        identifications: [
          {
            uri: `at://${MOCK_OBS_DID}/bio.lexicons.temp.v0-1.identification/${MOCK_OBS_RKEY}`,
            cid: "bafyid1",
            did: MOCK_OBS_DID,
            subject_uri: AUTO_ID_URI,
            subject_cid: "bafytest",
            scientific_name: "Quercus alba",
            kingdom: "Plantae",
            date_identified: new Date().toISOString(),
            identifier: {
              did: MOCK_OBS_DID,
              handle: "testuser.bsky.social",
              displayName: "Test User",
            },
          },
        ],
      });
      await mockInteractionsRoute(page);

      await page.goto("/");
      await openUploadModal(page);

      const speciesInput = page.getByLabel(/Taxon/i);
      await speciesInput.click();
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
        speciesInput.pressSequentially("quercus", { delay: 50 }),
      ]);
      const option = page.locator(".MuiAutocomplete-option").first();
      await authExpect(option).toBeVisible();
      await option.click();

      const latInput = page.getByLabel("Latitude");
      await latInput.scrollIntoViewIfNeeded();
      await latInput.fill("37.7749");
      await page.getByLabel("Longitude").fill("-122.4194");

      await page.getByRole("button", { name: /Submit/i }).click();
      await page.waitForURL(/\/observation\//, { timeout: 15_000 });

      await authExpect(page.getByText("Identification History")).toBeVisible({ timeout: 10000 });
      await authExpect(page.getByText("Quercus alba", { exact: false }).first()).toBeVisible();
      await authExpect(page.getByText("Community ID")).toBeVisible();
    },
  );
});
