import { test, expect, type Route } from "@playwright/test";
import { test as authTest, expect as authExpect, getTestUser } from "../fixtures/auth";
import { buildMockObservation, mockOwnObservationFeed } from "../helpers/mock-observation";

test.describe("Observation Edit - Logged Out", () => {
  // TC-EDIT-002: Edit menu item hidden for others' observations
  test("more menu does not show Edit for non-owned observation", async ({ page }) => {
    await page.goto("/explore");
    const firstCard = page.locator(".MuiCard-root").first();
    await expect(firstCard).toBeVisible({ timeout: 10000 });
    await firstCard.locator(".MuiCardActionArea-root").click();
    await expect(page).toHaveURL(/\/observation\//);
    const moreButton = page.getByLabel("More options").first();
    await expect(moreButton).toBeVisible({ timeout: 15000 });
    await moreButton.click();
    await expect(page.getByRole("menuitem", { name: "View on AT Protocol" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Edit" })).not.toBeVisible();
  });
});

authTest.describe("Observation Edit - Logged In", () => {
  // TC-EDIT-001: Edit menu item visible for own observation
  authTest("more menu shows Edit for own observation", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    await page.locator(".MuiCard-root").first().getByLabel("More options").click();
    await authExpect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  });

  // TC-EDIT-003: Edit hidden for others' observations in auth context
  authTest("more menu hides Edit for others' observations", async ({ authenticatedPage: page }) => {
    // Mock a feed with an observation owned by a different user
    const otherUserObs = buildMockObservation({
      uri: "at://did:plc:otheruser/org.observ.ing.occurrence/other123",
      observer: {
        did: "did:plc:otheruser",
        handle: "other.bsky.social",
        displayName: "Other User",
      },
      observers: [
        {
          did: "did:plc:otheruser",
          handle: "other.bsky.social",
          displayName: "Other User",
          role: "owner",
        },
      ],
    });
    const body = JSON.stringify({
      occurrences: [otherUserObs],
      cursor: null,
    });
    const handler = (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body,
      });
    await page.route("**/api/feeds/home*", handler);
    await page.route("**/api/feeds/explore*", handler);
    await page.route("**/api/occurrences/feed*", handler);

    await page.goto("/");
    const moreButton = page.getByLabel("More options").first();
    await authExpect(moreButton).toBeVisible({ timeout: 15000 });
    await moreButton.click();
    await authExpect(page.getByRole("menuitem", { name: "View on AT Protocol" })).toBeVisible();
    // Edit should not appear for others' observations
    await authExpect(page.getByRole("menuitem", { name: "Edit" })).not.toBeVisible();
  });

  // TC-EDIT-004: Clicking Edit opens upload modal in edit mode
  authTest("clicking Edit opens upload modal in edit mode", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page, {
      occurrenceRemarks: "Found near the meadow",
      eventDate: "2024-06-15",
    });
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    await page.locator(".MuiCard-root").first().getByLabel("More options").click();
    await page.getByRole("menuitem", { name: "Edit" }).click();

    // Should see "Edit Observation" title
    await authExpect(page.getByText("Edit Observation")).toBeVisible({ timeout: 5000 });
  });

  // TC-EDIT-005: Edit modal pre-populates species and notes
  authTest("edit modal pre-populates species and notes", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page, {
      occurrenceRemarks: "Found near the meadow",
      eventDate: "2024-06-15",
    });
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    await page.locator(".MuiCard-root").first().getByLabel("More options").click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await authExpect(page.getByText("Edit Observation")).toBeVisible({ timeout: 5000 });

    // Species input should have value
    const speciesInput = page.getByLabel(/Species/i);
    await authExpect(speciesInput).toHaveValue("Quercus alba");

    // Notes should have value
    const notesInput = page.getByLabel("Notes");
    await authExpect(notesInput).toHaveValue("Found near the meadow");
  });

  // TC-EDIT-006: Submitting edit sends PUT
  authTest("submitting edit sends PUT request", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page, {
      occurrenceRemarks: "Original notes",
      eventDate: "2024-06-15",
      location: { latitude: 37.7749, longitude: -122.4194 },
    });

    await page.route("**/api/occurrences", (route) => {
      if (route.request().method() === "PUT") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            uri: "at://did:plc:test/org.observ.ing.occurrence/test123",
            cid: "bafyupdated",
          }),
        });
      }
      return route.continue();
    });

    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    await page.locator(".MuiCard-root").first().getByLabel("More options").click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await authExpect(page.getByText("Edit Observation")).toBeVisible({ timeout: 5000 });

    const putRequest = page.waitForRequest(
      (req) => req.method() === "PUT" && req.url().includes("/api/occurrences"),
    );

    // Click Save Changes
    await page.getByRole("button", { name: "Save Changes" }).click();
    const req = await putRequest;
    authExpect(req.method()).toBe("PUT");
  });
});
