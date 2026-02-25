import { test, expect } from "@playwright/test";
import { test as authTest, expect as authExpect } from "../fixtures/auth";
import { mockOwnObservationFeed } from "../helpers/mock-observation";

test.describe("Delete Observation - Logged Out", () => {
  // TC-DELETE-002: Delete option hidden for others' observations
  test("more menu does not show Delete for non-owned observation", async ({ page }) => {
    await page.goto("/explore");
    const firstCard = page.locator(".MuiCard-root").first();
    await expect(firstCard).toBeVisible({ timeout: 10000 });
    await firstCard.locator(".MuiCardActionArea-root").click();
    await expect(page).toHaveURL(/\/observation\//);
    const moreButton = page.getByLabel("More options").first();
    await expect(moreButton).toBeVisible({ timeout: 15000 });
    await moreButton.click();
    await expect(page.getByRole("menuitem", { name: "View on AT Protocol" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete" })).not.toBeVisible();
  });
});

authTest.describe("Delete Observation - Logged In", () => {
  // TC-DELETE-001: Delete option visible for own observation
  authTest("more menu shows Delete for own observation", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    await page.locator(".MuiCard-root").first().getByLabel("More options").click();
    await authExpect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });

  // TC-DELETE-005: Delete confirmation dialog
  authTest("clicking Delete shows confirmation dialog", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    await page.locator(".MuiCard-root").first().getByLabel("More options").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const dialog = page.getByRole("dialog");
    await authExpect(dialog.getByText("Delete Observation?")).toBeVisible();
    await authExpect(dialog.getByText("Quercus alba")).toBeVisible();
    await authExpect(dialog.getByText("This action cannot be undone")).toBeVisible();
  });

  // TC-DELETE-006: Cancel delete
  authTest("clicking Cancel in delete dialog closes it", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    await page.locator(".MuiCard-root").first().getByLabel("More options").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await authExpect(page.getByText("Delete Observation?")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await authExpect(page.getByText("Delete Observation?")).not.toBeVisible();
  });

  // TC-DELETE-007: Confirm delete
  authTest("confirming delete calls DELETE API", async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await page.route("**/api/occurrences/**", (route) => {
      if (route.request().method() === "DELETE") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      }
      return route.continue();
    });

    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    await page.locator(".MuiCard-root").first().getByLabel("More options").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await authExpect(page.getByText("Delete Observation?")).toBeVisible();

    // Clicking Delete should send a DELETE request to the API.
    // After success the app reloads the page, so we verify via the request.
    const deleteRequest = page.waitForRequest(
      (req) => req.method() === "DELETE" && req.url().includes("/api/occurrences/"),
    );
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    const req = await deleteRequest;
    authExpect(req.url()).toContain("/api/occurrences/");
  });
});
