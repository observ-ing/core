import { expect } from "@playwright/test";
import { test as authTest, getTestUser } from "./fixtures/auth";
import { openUploadModal } from "./helpers/navigation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";

/**
 * End-to-end CRUD test against a live Bluesky PDS.
 *
 * Requires BLUESKY_TEST_EMAIL, BLUESKY_TEST_PASSWORD, and BLUESKY_TEST_HANDLE.
 * Creates real records on the test user's PDS and cleans them up at the end.
 */
authTest.describe("E2E CRUD flow", () => {
  let occurrenceUri: string | null = null;

  authTest("create, identify, and delete an occurrence", async ({ authenticatedPage: page }) => {
    const user = getTestUser();

    // Step 1: verify signed in
    await page.goto("/");
    await expect(page.getByText(`@${user.handle}`).first()).toBeVisible({ timeout: 10000 });

    // Step 2: create occurrence
    await authTest.step("create occurrence", async () => {
      await mockTaxaSearchRoute(page);
      await openUploadModal(page);

      const speciesInput = page.getByLabel(/Species/i);
      await speciesInput.click();
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
        speciesInput.pressSequentially("Quercus agrifolia", { delay: 50 }),
      ]);
      const option = page.locator(".MuiAutocomplete-option").first();
      await expect(option).toBeVisible();
      await option.click();

      const latInput = page.getByLabel("Latitude");
      await latInput.scrollIntoViewIfNeeded();
      await latInput.fill("37.7749");
      await page.getByLabel("Longitude").fill("-122.4194");

      await page.getByRole("button", { name: /Submit/i }).click();
      await page.waitForURL(/\/observation\//, { timeout: 30000 });

      const url = page.url();
      const match = url.match(/\/observation\/([^/]+)\/([^/]+)/);
      expect(match).toBeTruthy();
      const [, did, rkey] = match!;
      occurrenceUri = `at://${did}/bio.lexicons.temp.occurrence/${rkey}`;
    });

    // Step 3: add identification
    await authTest.step("add identification", async () => {
      const agreeBtn = page.getByRole("button", { name: "Agree" });
      await expect(agreeBtn).toBeVisible({ timeout: 10000 });
      const idDone = page.waitForResponse(
        (resp) => resp.request().method() === "POST" && resp.url().includes("/api/identifications"),
        { timeout: 15_000 },
      );
      await agreeBtn.click();
      await idDone;
    });

    // Step 4: edit occurrence (PUT /api/occurrences — added in #231)
    await authTest.step("update occurrence", async () => {
      const moreButton = page.getByLabel("More options").first();
      await expect(moreButton).toBeVisible({ timeout: 10000 });
      await moreButton.click();
      await page.getByRole("menuitem", { name: "Edit" }).click();
      await expect(page.getByText("Edit Observation")).toBeVisible({ timeout: 5000 });

      // Nudge the latitude to trigger a real edit. The `notes` field was
      // removed from the occurrence schema, and lat/lng are always present
      // on existing records — so this exercises the PUT round-trip without
      // depending on optional fields.
      const latInput = page.getByLabel("Latitude");
      await latInput.scrollIntoViewIfNeeded();
      await latInput.fill("37.8000");

      const updateDone = page.waitForResponse(
        (resp) => resp.request().method() === "PUT" && resp.url().includes("/api/occurrences"),
        { timeout: 15_000 },
      );
      await page.getByRole("button", { name: "Save Changes" }).click();
      const resp = await updateDone;
      expect(resp.status()).toBe(200);
      await expect(page.getByText("Edit Observation")).not.toBeVisible({ timeout: 15_000 });
    });

    // Step 5: delete occurrence
    await authTest.step("delete occurrence", async () => {
      const moreButton = page.getByLabel("More options").first();
      await expect(moreButton).toBeVisible({ timeout: 10000 });
      await moreButton.click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await expect(page.getByText("Delete Observation?")).toBeVisible();

      const deleteDone = page.waitForResponse(
        (resp) => resp.request().method() === "DELETE" && resp.url().includes("/api/occurrences/"),
        { timeout: 15_000 },
      );
      await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
      await deleteDone;
      await page.waitForURL("/", { timeout: 15_000 });
      occurrenceUri = null;
    });
  });

  authTest.afterEach(async ({ authenticatedPage: page }) => {
    // Clean up if the test failed before the delete step
    if (occurrenceUri) {
      await page.request
        .delete(`http://127.0.0.1:3000/api/occurrences/${encodeURIComponent(occurrenceUri)}`)
        .catch(() => {});
      occurrenceUri = null;
    }
  });
});
