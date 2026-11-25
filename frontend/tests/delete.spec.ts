import { test, expect } from "./fixtures/mock-auth";
import { mockOwnObservationFeed, mockObservationDetailRoute } from "./helpers/mock-observation";
import { mockJson } from "./helpers/mock-api";
import { openFirstCard, openFirstCardMenu } from "./helpers/navigation";

test.describe("Delete Observation - Logged Out", () => {
  test("more menu does not show Delete for non-owned observation", async ({ page }) => {
    await mockOwnObservationFeed(page);
    await mockObservationDetailRoute(page);
    await page.goto("/explore");
    await openFirstCard(page);
    const moreButton = page.getByLabel("More options").first();
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    await expect(page.getByRole("menuitem", { name: "View on AT Protocol" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete" })).not.toBeVisible();
  });
});

test.describe("Delete Observation - Logged In", () => {
  test("more menu shows Delete for own observation", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto("/");
    await openFirstCardMenu(page);
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });

  test("clicking Delete shows confirmation dialog", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto("/");
    await openFirstCardMenu(page);
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Delete Observation?")).toBeVisible();
    await expect(dialog.getByText("Quercus alba")).toBeVisible();
    await expect(dialog.getByText("This action cannot be undone")).toBeVisible();
  });

  test("clicking Cancel in delete dialog closes it", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto("/");
    await openFirstCardMenu(page);
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByText("Delete Observation?")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Delete Observation?")).not.toBeVisible();
  });

  test("confirming delete calls DELETE API", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await mockJson(page, "**/api/occurrences/**", { success: true }, { method: "DELETE" });

    await page.goto("/");
    await openFirstCardMenu(page);
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByText("Delete Observation?")).toBeVisible();

    // Clicking Delete should send a DELETE request to the API.
    // After success the app reloads the page, so we verify via the request.
    const deleteRequest = page.waitForRequest(
      (req) => req.method() === "DELETE" && req.url().includes("/api/occurrences/"),
    );
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    const req = await deleteRequest;
    expect(req.url()).toContain("/api/occurrences/");
  });
});
