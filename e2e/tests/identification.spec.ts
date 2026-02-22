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

authTest.describe("Identification - Logged In", () => {
  authTest.beforeEach(async ({ authenticatedPage: page }) => {
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
  });

  // TC-ID-001: Agree button sends agreement
  authTest(
    "Agree button sends POST with isAgreement true",
    async ({ authenticatedPage: page }) => {
      await page.route("**/api/identifications", (route) => {
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
      const agreeBtn = page.getByRole("button", { name: "Agree" });
      await authExpect(agreeBtn).toBeVisible({ timeout: 10000 });

      const postRequest = page.waitForRequest(
        (req: any) =>
          req.method() === "POST" &&
          req.url().includes("/api/identifications"),
      );
      await agreeBtn.click();
      const req = await postRequest;
      const body = JSON.parse(req.postData() || "{}");
      authExpect(body.isAgreement).toBe(true);
    },
  );

  // TC-ID-002: Suggest Different ID opens form
  authTest(
    "Suggest Different ID button opens form with species input",
    async ({ authenticatedPage: page }) => {
      await page.goto(DETAIL_URL);
      const suggestBtn = page.getByRole("button", {
        name: "Suggest Different ID",
      });
      await authExpect(suggestBtn).toBeVisible({ timeout: 10000 });
      await suggestBtn.click();

      await authExpect(page.getByLabel("Species Name")).toBeVisible();
      await authExpect(page.getByLabel("Comment (optional)")).toBeVisible();
      await authExpect(page.getByLabel("Confidence")).toBeVisible();
    },
  );

  // TC-ID-003: Submit different ID sends POST
  authTest(
    "submitting different ID sends POST with new scientificName",
    async ({ authenticatedPage: page }) => {
      await page.route("**/api/identifications", (route) => {
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
      const suggestBtn = page.getByRole("button", {
        name: "Suggest Different ID",
      });
      await authExpect(suggestBtn).toBeVisible({ timeout: 10000 });
      await suggestBtn.click();

      const speciesInput = page.getByLabel("Species Name");
      await speciesInput.fill("Quercus rubra");

      const postRequest = page.waitForRequest(
        (req: any) =>
          req.method() === "POST" &&
          req.url().includes("/api/identifications"),
      );
      await page.getByRole("button", { name: "Submit ID" }).click();
      const req = await postRequest;
      const body = JSON.parse(req.postData() || "{}");
      authExpect(body.scientificName).toBe("Quercus rubra");
      authExpect(body.isAgreement).toBe(false);
    },
  );

  // TC-ID-004: Cancel closes the suggest form
  authTest(
    "Cancel closes the suggest form",
    async ({ authenticatedPage: page }) => {
      await page.goto(DETAIL_URL);
      const suggestBtn = page.getByRole("button", {
        name: "Suggest Different ID",
      });
      await authExpect(suggestBtn).toBeVisible({ timeout: 10000 });
      await suggestBtn.click();
      await authExpect(page.getByLabel("Species Name")).toBeVisible();

      await page.getByRole("button", { name: "Cancel" }).click();
      await authExpect(page.getByLabel("Species Name")).not.toBeVisible();
    },
  );

  // TC-ID-005: Add Another Organism shows info box
  authTest(
    "Add Another Organism shows info box with next subject index",
    async ({ authenticatedPage: page }) => {
      await page.goto(DETAIL_URL);
      const addOrgBtn = page.getByRole("button", {
        name: "Add Another Organism",
      });
      await authExpect(addOrgBtn).toBeVisible({ timeout: 10000 });
      await addOrgBtn.click();

      await authExpect(page.getByText("Adding organism #2")).toBeVisible();
      await authExpect(page.getByLabel("Species Name")).toBeVisible();
    },
  );
});
