import { test, expect } from "@playwright/test";
import {
  test as authTest,
  expect as authExpect,
} from "../fixtures/auth";
import {
  mockObservationDetailRoute,
  mockInteractionsRoute,
  buildMockInteraction,
} from "../helpers/mock-observation";

const TEST_DID = "did:plc:testuser123";
const TEST_RKEY = "obs456";
const DETAIL_URL = `/observation/${TEST_DID}/${TEST_RKEY}`;

function observationOverrides() {
  return {
    uri: `at://${TEST_DID}/org.observ.ing.occurrence/${TEST_RKEY}`,
    observer: {
      did: TEST_DID,
      handle: "naturalist.bsky.social",
      displayName: "Nature Lover",
    },
    observers: [],
  };
}

test.describe("Interactions - Logged Out", () => {
  // TC-INT-007: Login prompt
  test("shows login prompt when logged out", async ({ page }) => {
    await mockObservationDetailRoute(page, observationOverrides());
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(
      page.getByText("Log in to add interactions"),
    ).toBeVisible({ timeout: 10000 });
  });
});

authTest.describe("Interactions - Logged In", () => {
  // TC-INT-001: Section visible
  authTest(
    "Species Interactions section is visible",
    async ({ authenticatedPage: page }) => {
      await mockObservationDetailRoute(page, observationOverrides());
      await mockInteractionsRoute(page);

      await page.goto(DETAIL_URL);
      await authExpect(
        page.getByText("Species Interactions"),
      ).toBeVisible({ timeout: 10000 });
    },
  );

  // TC-INT-002: Add button opens form
  authTest(
    "Add button opens interaction form",
    async ({ authenticatedPage: page }) => {
      await mockObservationDetailRoute(page, observationOverrides());
      await mockInteractionsRoute(page);

      await page.goto(DETAIL_URL);
      // Find the Add button in the Species Interactions section
      const interactionSection = page.locator(
        "text=Species Interactions",
      ).locator("..").locator("..");
      const addBtn = interactionSection.getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();

      await authExpect(
        page.getByLabel("Other organism (Subject B)"),
      ).toBeVisible();
      await authExpect(page.getByLabel("Interaction Type")).toBeVisible();
      await authExpect(page.getByLabel("Direction")).toBeVisible();
      await authExpect(page.getByLabel("Confidence")).toBeVisible();
    },
  );

  // TC-INT-003: Submit interaction sends POST
  authTest(
    "submitting interaction sends POST with correct data",
    async ({ authenticatedPage: page }) => {
      await mockObservationDetailRoute(page, observationOverrides());
      await mockInteractionsRoute(page);

      await page.route("**/api/interactions", (route) => {
        if (route.request().method() === "POST") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ success: true }),
          });
        }
        return route.continue();
      });

      await page.goto(DETAIL_URL);
      const interactionSection = page.locator(
        "text=Species Interactions",
      ).locator("..").locator("..");
      const addBtn = interactionSection.getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();

      // Fill in Subject B
      await page
        .getByLabel("Other organism (Subject B)")
        .fill("Apis mellifera");

      const postRequest = page.waitForRequest(
        (req: any) =>
          req.method() === "POST" &&
          req.url().includes("/api/interactions"),
      );
      await page
        .getByRole("button", { name: "Add Interaction" })
        .click();
      const req = await postRequest;
      const body = JSON.parse(req.postData() || "{}");
      authExpect(body.subjectB.scientificName).toBe("Apis mellifera");
    },
  );

  // TC-INT-004: Existing interactions displayed
  authTest(
    "existing interactions displayed with type chip and direction",
    async ({ authenticatedPage: page }) => {
      await mockObservationDetailRoute(page, observationOverrides());
      const interaction = buildMockInteraction();
      await mockInteractionsRoute(page, [interaction]);

      await page.goto(DETAIL_URL);
      await authExpect(
        page.getByText("Parasitism"),
      ).toBeVisible({ timeout: 10000 });
      // Direction arrow text
      await authExpect(
        page.getByText("Andricus quercuscalifornicus"),
      ).toBeVisible();
    },
  );

  // TC-INT-005: Cancel closes form
  authTest(
    "Cancel closes the interaction form",
    async ({ authenticatedPage: page }) => {
      await mockObservationDetailRoute(page, observationOverrides());
      await mockInteractionsRoute(page);

      await page.goto(DETAIL_URL);
      const interactionSection = page.locator(
        "text=Species Interactions",
      ).locator("..").locator("..");
      const addBtn = interactionSection.getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();
      await authExpect(
        page.getByLabel("Other organism (Subject B)"),
      ).toBeVisible();

      await page.getByRole("button", { name: "Cancel" }).click();
      await authExpect(
        page.getByLabel("Other organism (Subject B)"),
      ).not.toBeVisible();
    },
  );

  // TC-INT-006: Empty state message
  authTest(
    "empty interactions show no-interactions message",
    async ({ authenticatedPage: page }) => {
      await mockObservationDetailRoute(page, observationOverrides());
      await mockInteractionsRoute(page, []);

      await page.goto(DETAIL_URL);
      await authExpect(
        page.getByText("No interactions documented yet"),
      ).toBeVisible({ timeout: 10000 });
    },
  );
});
