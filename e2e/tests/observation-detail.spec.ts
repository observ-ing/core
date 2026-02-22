import { test, expect } from "@playwright/test";
import {
  test as authTest,
  expect as authExpect,
  getTestUser,
} from "../fixtures/auth";
import {
  mockObservationDetailRoute,
  mockInteractionsRoute,
} from "../helpers/mock-observation";

const TEST_DID = "did:plc:testuser123";
const TEST_RKEY = "obs456";
const DETAIL_URL = `/observation/${TEST_DID}/${TEST_RKEY}`;

test.describe("Observation Detail - Display", () => {
  // TC-DETAIL-001: Species name and vernacular name
  test("renders species name and vernacular name", async ({ page }) => {
    await mockObservationDetailRoute(page, {
      uri: `at://${TEST_DID}/org.observ.ing.occurrence/${TEST_RKEY}`,
      observer: {
        did: TEST_DID,
        handle: "naturalist.bsky.social",
        displayName: "Nature Lover",
      },
      observers: [
        {
          did: TEST_DID,
          handle: "naturalist.bsky.social",
          displayName: "Nature Lover",
          role: "owner",
        },
      ],
    });
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(page.getByText("Quercus alba")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("White Oak")).toBeVisible();
  });

  // TC-DETAIL-002: Observation date and coordinates
  test("shows observation date and coordinates", async ({ page }) => {
    await mockObservationDetailRoute(page, {
      uri: `at://${TEST_DID}/org.observ.ing.occurrence/${TEST_RKEY}`,
      observer: {
        did: TEST_DID,
        handle: "naturalist.bsky.social",
        displayName: "Nature Lover",
      },
      observers: [],
    });
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(page.getByText("Observed")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("37.77490")).toBeVisible();
    await expect(page.getByText("-122.41940")).toBeVisible();
  });

  // TC-DETAIL-003: Notes/remarks
  test("shows observation notes", async ({ page }) => {
    await mockObservationDetailRoute(page, {
      uri: `at://${TEST_DID}/org.observ.ing.occurrence/${TEST_RKEY}`,
      observer: {
        did: TEST_DID,
        handle: "naturalist.bsky.social",
        displayName: "Nature Lover",
      },
      observers: [],
    });
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(page.getByText("Notes")).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("Found near the eastern edge of the meadow"),
    ).toBeVisible();
  });

  // TC-DETAIL-004: Observer info
  test("shows observer info with display name", async ({ page }) => {
    await mockObservationDetailRoute(page, {
      uri: `at://${TEST_DID}/org.observ.ing.occurrence/${TEST_RKEY}`,
      observer: {
        did: TEST_DID,
        handle: "naturalist.bsky.social",
        displayName: "Nature Lover",
      },
      observers: [],
    });
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(page.getByText("Nature Lover")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("@naturalist.bsky.social")).toBeVisible();
  });

  // TC-DETAIL-005: Location name
  test("shows verbatim locality", async ({ page }) => {
    await mockObservationDetailRoute(page, {
      uri: `at://${TEST_DID}/org.observ.ing.occurrence/${TEST_RKEY}`,
      observer: {
        did: TEST_DID,
        handle: "naturalist.bsky.social",
        displayName: "Nature Lover",
      },
      observers: [],
    });
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(page.getByText("Location")).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("Golden Gate Park, San Francisco, CA"),
    ).toBeVisible();
  });

  // TC-DETAIL-006: Identification history section
  test("shows identification history section", async ({ page }) => {
    await mockObservationDetailRoute(page, {
      uri: `at://${TEST_DID}/org.observ.ing.occurrence/${TEST_RKEY}`,
      observer: {
        did: TEST_DID,
        handle: "naturalist.bsky.social",
        displayName: "Nature Lover",
      },
      observers: [],
      scientificName: "Quercus alba",
    });
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(
      page.getByText("Identification History"),
    ).toBeVisible({ timeout: 10000 });
  });

  // TC-DETAIL-007: Discussion section
  test("shows discussion section", async ({ page }) => {
    await mockObservationDetailRoute(page, {
      uri: `at://${TEST_DID}/org.observ.ing.occurrence/${TEST_RKEY}`,
      observer: {
        did: TEST_DID,
        handle: "naturalist.bsky.social",
        displayName: "Nature Lover",
      },
      observers: [],
    });
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(page.getByText("Discussion")).toBeVisible({ timeout: 10000 });
  });

  // TC-DETAIL-008: Species interactions section
  test("shows species interactions section", async ({ page }) => {
    await mockObservationDetailRoute(page, {
      uri: `at://${TEST_DID}/org.observ.ing.occurrence/${TEST_RKEY}`,
      observer: {
        did: TEST_DID,
        handle: "naturalist.bsky.social",
        displayName: "Nature Lover",
      },
      observers: [],
    });
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(
      page.getByText("Species Interactions"),
    ).toBeVisible({ timeout: 10000 });
  });

  // TC-DETAIL-009: Like button visible
  test("like button visible on detail page", async ({ page }) => {
    await mockObservationDetailRoute(page, {
      uri: `at://${TEST_DID}/org.observ.ing.occurrence/${TEST_RKEY}`,
      observer: {
        did: TEST_DID,
        handle: "naturalist.bsky.social",
        displayName: "Nature Lover",
      },
      observers: [],
    });
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(
      page.getByRole("button", { name: "Like" }),
    ).toBeVisible({ timeout: 10000 });
  });

  // TC-DETAIL-010: Logged-out prompts
  test("logged-out user sees login prompts for ID and comments", async ({
    page,
  }) => {
    await mockObservationDetailRoute(page, {
      uri: `at://${TEST_DID}/org.observ.ing.occurrence/${TEST_RKEY}`,
      observer: {
        did: TEST_DID,
        handle: "naturalist.bsky.social",
        displayName: "Nature Lover",
      },
      observers: [],
      scientificName: "Quercus alba",
    });
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(
      page.getByText("Log in to add an identification"),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("Log in to add a comment"),
    ).toBeVisible();
  });
});
