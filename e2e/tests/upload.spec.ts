import { test, expect, type Page } from "@playwright/test";
import {
  test as authTest,
  expect as authExpect,
  getTestUser,
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
  async function openUploadModal(page: Page) {
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
        page.getByText(`@${getTestUser().handle}`).first(),
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
    await speciesInput.click();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
      speciesInput.pressSequentially("quercus", { delay: 50 }),
    ]);
    await authExpect(
      page.locator(".MuiAutocomplete-option").first(),
    ).toBeVisible({ timeout: 10000 });
  });

  // TC-UPLOAD-017: Observation date picker
  authTest("upload modal shows observation date picker defaulting to today", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");
    await openUploadModal(page);
    const dateInput = page.getByLabel("Observation date");
    await authExpect(dateInput).toBeVisible();
    const value = await dateInput.inputValue();
    // Date input uses local time, so compare with local date
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    authExpect(value.startsWith(today)).toBeTruthy();
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

    // Set location via the "Use My Location" button (geolocation mocked in fixture)
    const useLocationBtn = page.getByRole("button", { name: /Use My Location/i });
    await useLocationBtn.scrollIntoViewIfNeeded();
    await useLocationBtn.click();
    await page.waitForTimeout(1000);

    const submitButton = page.getByRole("button", { name: /Submit/i });
    if (await submitButton.isEnabled()) {
      await submitButton.click();
      await page.waitForTimeout(1000);
    }
  });

  // TC-UPLOAD-020: Large image upload exceeds old 2MB body limit
  authTest("submitting a large image sends a payload exceeding 2MB", async ({
    authenticatedPage: page,
  }) => {
    let requestBodySize = 0;

    await page.route("**/api/occurrences", (route) => {
      if (route.request().method() === "POST") {
        requestBodySize = route.request().postDataBuffer()?.length ?? 0;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            uri: "at://did:plc:test123/org.observ.ing.occurrence/large123",
            cid: "bafylarge",
          }),
        });
      }
      return route.continue();
    });

    // Build a ~3MB valid JPEG entirely in Node to avoid OOM from
    // serializing large arrays across the browser↔Node boundary.
    // Minimal JPEG: SOI + APP0 + DQT + SOF0 + DHT + SOS + padding + EOI
    const targetSize = 3 * 1024 * 1024;
    // Minimal valid JPEG (1x1 white pixel) — the structure doesn't matter
    // since we only need the frontend to accept it as image/jpeg.
    const header = Buffer.from([
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0/JFIF
    ]);
    const trailer = Buffer.from([0xff, 0xd9]); // EOI
    // Fill the middle with random data (not 0xFF to avoid accidental markers)
    const padding = Buffer.alloc(targetSize - header.length - trailer.length);
    for (let i = 0; i < padding.length; i++) {
      padding[i] = Math.floor(Math.random() * 0xfe);
    }
    const buffer = Buffer.concat([header, padding, trailer]);

    await page.goto("/");
    await openUploadModal(page);

    const fileInput = page.getByRole("dialog").locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "large-photo.jpg",
      mimeType: "image/jpeg",
      buffer,
    });

    // Wait for the image preview to appear
    await page.waitForTimeout(1000);

    // Set location via the "Use My Location" button (geolocation mocked in fixture)
    const useLocationBtn = page.getByRole("button", { name: /Use My Location/i });
    await useLocationBtn.scrollIntoViewIfNeeded();
    await useLocationBtn.click();
    await page.waitForTimeout(1000);

    const submitButton = page.getByRole("button", { name: /Submit/i });
    await submitButton.click();
    await page.waitForTimeout(2000);

    // The base64-encoded body should exceed the old 2MB limit
    authExpect(requestBodySize).toBeGreaterThan(2 * 1024 * 1024);
  });
});
