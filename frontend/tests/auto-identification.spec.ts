import { test, expect } from "./fixtures/mock-auth";
import {
  openUploadModal,
  gotoUploadStep,
  revealCoordinateInputs,
  searchTaxa,
} from "./helpers/navigation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";
import {
  mockOwnObservationFeed,
  mockObservationDetailRoute,
  MOCK_OBS_DID,
  MOCK_OBS_RKEY,
} from "./helpers/mock-observation";
import { mockJson } from "./helpers/mock-api";

const AUTO_ID_RKEY = "autoidtest123";
const AUTO_ID_URI = `at://${MOCK_OBS_DID}/bio.lexicons.temp.v0-1.occurrence/${AUTO_ID_RKEY}`;

test.describe("Auto-Identification on Upload", () => {
  test("observation uploaded with species shows auto-created identification", async ({
    authenticatedPage: page,
  }) => {
    await mockOwnObservationFeed(page);
    await mockTaxaSearchRoute(page);

    // Mock POST /api/occurrences to return a known URI
    await mockJson(
      page,
      "**/api/occurrences",
      { uri: AUTO_ID_URI, cid: "bafytest" },
      { method: "POST", status: 201 },
    );

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

    await page.goto("/");
    await openUploadModal(page);
    await gotoUploadStep(page, "Identify");

    const speciesInput = page.getByLabel(/Taxon/i);
    await searchTaxa(speciesInput, "quercus");
    const option = page.locator(".MuiAutocomplete-option").first();
    await expect(option).toBeVisible();
    await option.click();

    await revealCoordinateInputs(page);
    const latInput = page.getByLabel("Latitude");
    await latInput.scrollIntoViewIfNeeded();
    await latInput.fill("37.7749");
    await page.getByLabel("Longitude").fill("-122.4194");

    await page.getByRole("button", { name: /Submit/i }).click();

    // Submission no longer navigates: the modal closes in place and the
    // ingester poll runs in the background behind the TopBar indicator. Wait
    // for the modal to close, then go to the (mocked) detail page directly to
    // assert the auto-created identification rendered.
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
    await page.goto(`/observation/${MOCK_OBS_DID}/${AUTO_ID_RKEY}`);

    await expect(page.getByText("Identification History")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Quercus alba", { exact: false }).first()).toBeVisible();
    // `exact` so this matches only the identification's "Community ID"
    // caption, not the "Has a community ID" row in the data quality section.
    await expect(page.getByText("Community ID", { exact: true })).toBeVisible();
  });
});
