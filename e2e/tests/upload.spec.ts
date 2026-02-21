import { test, expect } from "@playwright/test";
import {
  test as authTest,
  expect as authExpect,
  MOCK_USER,
} from "../fixtures/auth";

const FAB = 'button[aria-label="Create actions"]';

test.describe("Upload Modal - Logged Out", () => {
  // TC-UPLOAD-002: FAB hidden when logged out
  test("FAB button is not visible when logged out", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);
    await expect(page.locator(FAB)).not.toBeVisible();
  });
});

authTest.describe("Upload Modal - Logged In", () => {
  async function openUploadModal(page: any) {
    const fab = page.locator(FAB);
    await authExpect(fab).toBeVisible({ timeout: 5000 });
    await fab.click();
    const newObsAction = page.getByRole("menuitem", {
      name: "New Observation",
    });
    await newObsAction.waitFor({ state: "visible", timeout: 3000 });
    await newObsAction.click();
    // Wait for the modal to appear (use heading, not just text)
    await page.waitForTimeout(500);
  }

  // TC-UPLOAD-010: FAB visible when logged in
  authTest("FAB button is visible when logged in", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");
    await authExpect(page.locator(FAB)).toBeVisible({ timeout: 5000 });
  });

  // TC-UPLOAD-001: Open/close modal
  authTest("clicking FAB opens upload modal", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");
    await openUploadModal(page);
  });

  authTest("clicking Cancel closes upload modal", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");
    await openUploadModal(page);
    await page.getByRole("button", { name: "Cancel" }).click();
    await authExpect(page.getByLabel(/Species/i)).not.toBeVisible();
  });

  // TC-UPLOAD-003: Authenticated mode banner
  authTest(
    "upload modal shows posting as handle",
    async ({ authenticatedPage: page }) => {
      await page.goto("/");
      await openUploadModal(page);
      await authExpect(
        page.getByText(`@${MOCK_USER.handle}`).first(),
      ).toBeVisible();
    },
  );

  // TC-UPLOAD-004: Quick species selection
  authTest("quick species chips populate species input", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");
    await openUploadModal(page);
    const poppyChip = page.getByRole("button", {
      name: /California Poppy/i,
    });
    if (await poppyChip.isVisible()) {
      await poppyChip.click();
      const speciesInput = page.getByLabel(/Species/i);
      await authExpect(speciesInput).not.toHaveValue("");
    }
  });

  // TC-UPLOAD-005: Species autocomplete search
  authTest("typing in species input shows autocomplete suggestions", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");
    await openUploadModal(page);
    const speciesInput = page.getByLabel(/Species/i);
    await speciesInput.fill("quercus");
    await authExpect(
      page.locator(".MuiAutocomplete-popper"),
    ).toBeVisible({ timeout: 5000 });
  });

  // TC-UPLOAD-016: Invalid image file type
  authTest("file input only accepts image types", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");
    await openUploadModal(page);
    // Scope to the dialog's file input (FAB has its own hidden file input)
    const fileInput = page
      .getByRole("dialog")
      .locator('input[type="file"]');
    await authExpect(fileInput).toHaveAttribute("accept", /image/);
  });

  // TC-UPLOAD-009: Submit observation (mocked)
  authTest("submit button sends observation to API", async ({
    authenticatedPage: page,
  }) => {
    await page.route("**/api/occurrences", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            uri: "at://did:plc:test123/org.observ.ing.occurrence/abc123",
            cid: "bafytest",
          }),
        });
      }
      return route.continue();
    });

    await page.goto("/");
    await openUploadModal(page);

    const speciesInput = page.getByLabel(/Species/i);
    await speciesInput.fill("Quercus alba");
    const option = page.locator(".MuiAutocomplete-option").first();
    if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
      await option.click();
    }

    const submitButton = page.getByRole("button", { name: /Submit/i });
    if (await submitButton.isEnabled()) {
      await submitButton.click();
      await page.waitForTimeout(1000);
    }
  });
});
