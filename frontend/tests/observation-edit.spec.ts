import { test, expect } from "./fixtures/mock-auth";
import {
  buildMockObservation,
  mockFeed,
  mockOwnObservationFeed,
  mockObservationDetailRoute,
} from "./helpers/mock-observation";
import { gotoUploadStep, openFirstCard, openFirstCardMenu } from "./helpers/navigation";
import { mockJson } from "./helpers/mock-api";

test.describe("Observation Edit - Logged Out", () => {
  test("more menu does not show Edit for non-owned observation", async ({ page }) => {
    await mockOwnObservationFeed(page);
    await mockObservationDetailRoute(page);
    await page.goto("/explore");
    await openFirstCard(page);
    const moreButton = page.getByLabel("More options").first();
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    await expect(page.getByRole("menuitem", { name: "View on AT Protocol" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Edit" })).not.toBeVisible();
  });
});

test.describe("Observation Edit - Logged In", () => {
  test("more menu shows Edit for own observation", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto("/");
    await openFirstCardMenu(page);
    await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  });

  test("more menu hides Edit for others' observations", async ({ authenticatedPage: page }) => {
    // Mock a feed with an observation owned by a different user
    const otherUserObs = buildMockObservation({
      uri: "at://did:plc:otheruser/bio.lexicons.temp.v0-1.occurrence/other123",
      observer: {
        did: "did:plc:otheruser",
        handle: "other.bsky.social",
        displayName: "Other User",
      },
    });
    await mockFeed(page, [otherUserObs]);

    await page.goto("/");
    const moreButton = page.getByLabel("More options").first();
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    await expect(page.getByRole("menuitem", { name: "View on AT Protocol" })).toBeVisible();
    // Edit should not appear for others' observations
    await expect(page.getByRole("menuitem", { name: "Edit" })).not.toBeVisible();
  });

  test("clicking Edit opens upload modal in edit mode", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page, {
      eventDate: "2024-06-15",
    });
    await page.goto("/");
    await openFirstCardMenu(page);
    await page.getByRole("menuitem", { name: "Edit" }).click();

    // Should see "Edit Observation" title
    await expect(page.getByText("Edit Observation")).toBeVisible({ timeout: 5000 });
  });

  test("edit modal pre-populates species", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page, {
      eventDate: "2024-06-15",
    });
    await page.goto("/");
    await openFirstCardMenu(page);
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByText("Edit Observation")).toBeVisible({ timeout: 5000 });

    // Species input lives in the (collapsed) Identify step; reveal it first.
    await gotoUploadStep(page, "Identify");
    const speciesInput = page.getByLabel(/Taxon/i);
    await expect(speciesInput).toHaveValue("Quercus alba");
  });

  test("submitting edit sends PUT request", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page, {
      eventDate: "2024-06-15",
      location: { latitude: 37.7749, longitude: -122.4194 },
    });

    await mockJson(
      page,
      "**/api/occurrences",
      {
        uri: "at://did:plc:test/bio.lexicons.temp.v0-1.occurrence/test123",
        cid: "bafyupdated",
      },
      { method: "PUT" },
    );

    await page.goto("/");
    await openFirstCardMenu(page);
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByText("Edit Observation")).toBeVisible({ timeout: 5000 });

    const putRequest = page.waitForRequest(
      (req) => req.method() === "PUT" && req.url().includes("/api/occurrences"),
    );

    // Click Save Changes
    await page.getByRole("button", { name: "Save Changes" }).click();
    const req = await putRequest;
    expect(req.method()).toBe("PUT");
  });
});
