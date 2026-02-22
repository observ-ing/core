import { test, expect } from "@playwright/test";
import {
  test as authTest,
  expect as authExpect,
} from "../fixtures/auth";
import {
  mockObservationDetailRoute,
  mockInteractionsRoute,
  buildMockComment,
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

test.describe("Comments - Logged Out", () => {
  // TC-CMT-006: Login prompt for comments
  test("shows login prompt when logged out", async ({ page }) => {
    await mockObservationDetailRoute(page, observationOverrides());
    await mockInteractionsRoute(page);

    await page.goto(DETAIL_URL);
    await expect(
      page.getByText("Log in to add a comment"),
    ).toBeVisible({ timeout: 10000 });
  });
});

authTest.describe("Comments - Logged In", () => {
  // TC-CMT-001: Existing comments displayed
  authTest(
    "discussion section shows existing comments",
    async ({ authenticatedPage: page }) => {
      const comment = buildMockComment({
        body: "Beautiful specimen! Love the bark detail.",
        commenter: {
          did: "did:plc:commenter1",
          handle: "botanist.bsky.social",
          displayName: "Dr. Botanist",
        },
      });
      await mockObservationDetailRoute(page, {
        ...observationOverrides(),
        comments: [comment],
      });
      await mockInteractionsRoute(page);

      await page.goto(DETAIL_URL);
      await authExpect(page.getByText("Discussion")).toBeVisible({
        timeout: 10000,
      });
      await authExpect(page.getByText("Dr. Botanist")).toBeVisible();
      await authExpect(
        page.getByText("Beautiful specimen! Love the bark detail."),
      ).toBeVisible();
    },
  );

  // TC-CMT-002: Add button opens comment form
  authTest(
    "Add button opens comment form",
    async ({ authenticatedPage: page }) => {
      await mockObservationDetailRoute(page, observationOverrides());
      await mockInteractionsRoute(page);

      await page.goto(DETAIL_URL);
      // The "Add" button in the Discussion section
      const addBtn = page
        .locator("text=Discussion")
        .locator("..")
        .locator("..")
        .getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();

      await authExpect(page.getByLabel("Add a comment")).toBeVisible();
      await authExpect(
        page.getByPlaceholder("Share your thoughts, ask questions..."),
      ).toBeVisible();
    },
  );

  // TC-CMT-003: Cancel closes comment form
  authTest(
    "Cancel closes comment form",
    async ({ authenticatedPage: page }) => {
      await mockObservationDetailRoute(page, observationOverrides());
      await mockInteractionsRoute(page);

      await page.goto(DETAIL_URL);
      const addBtn = page
        .locator("text=Discussion")
        .locator("..")
        .locator("..")
        .getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();
      await authExpect(page.getByLabel("Add a comment")).toBeVisible();

      await page.getByRole("button", { name: "Cancel" }).click();
      await authExpect(page.getByLabel("Add a comment")).not.toBeVisible();
    },
  );

  // TC-CMT-004: Post comment sends POST
  authTest(
    "posting comment sends POST with body text",
    async ({ authenticatedPage: page }) => {
      await mockObservationDetailRoute(page, observationOverrides());
      await mockInteractionsRoute(page);

      await page.route("**/api/comments", (route) => {
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
      const addBtn = page
        .locator("text=Discussion")
        .locator("..")
        .locator("..")
        .getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();

      await page
        .getByPlaceholder("Share your thoughts, ask questions...")
        .fill("This is a test comment");

      const postRequest = page.waitForRequest(
        (req: any) =>
          req.method() === "POST" && req.url().includes("/api/comments"),
      );
      await page.getByRole("button", { name: "Post" }).click();
      const req = await postRequest;
      const body = JSON.parse(req.postData() || "{}");
      authExpect(body.body).toBe("This is a test comment");
    },
  );

  // TC-CMT-005: Empty state message
  authTest(
    "empty comments shows no-comments message",
    async ({ authenticatedPage: page }) => {
      await mockObservationDetailRoute(page, {
        ...observationOverrides(),
        comments: [],
      });
      await mockInteractionsRoute(page);

      await page.goto(DETAIL_URL);
      await authExpect(
        page.getByText("No comments yet"),
      ).toBeVisible({ timeout: 10000 });
    },
  );
});
