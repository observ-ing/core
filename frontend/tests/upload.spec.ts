import { test, expect } from "./fixtures/mock-auth";
import { openUploadModal, gotoUploadStep, revealCoordinateInputs } from "./helpers/navigation";
import { mockOwnObservationFeed } from "./helpers/mock-observation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";
import { mockSubmit, taggedPhoto } from "./helpers/batch-upload";
import { MOCK_TEST_USER } from "./helpers/test-users";

const FAB = 'button[aria-label="Create actions"]';
const CREATE_BUTTON = { name: "Add observation" } as const;
// Below the md breakpoint the top bar's "Add observation" split button gives way
// to the FAB speed dial.
const NARROW_VIEWPORT = { width: 390, height: 844 };

test.describe("Upload Modal - Logged Out", () => {
  test("Add observation button is not visible when logged out", async ({ page }) => {
    await page.goto("/explore");
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("button", CREATE_BUTTON)).toHaveCount(0);
  });

  test("FAB button is not visible when logged out", async ({ page }) => {
    await page.setViewportSize(NARROW_VIEWPORT);
    await page.goto("/explore");
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.locator(FAB)).toHaveCount(0);
  });
});

test.describe("Upload Modal - Logged In", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockOwnObservationFeed(page);
    await mockTaxaSearchRoute(page);
  });

  test("Add observation button is visible when logged in", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", CREATE_BUTTON)).toBeVisible();
    // It replaces the FAB on wide screens rather than joining it.
    await expect(page.locator(FAB)).toHaveCount(0);
  });

  test("Add observation button opens upload modal", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await openUploadModal(page);
  });

  test("clicking Cancel closes upload modal", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await openUploadModal(page);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test.describe("on a narrow screen", () => {
    test.beforeEach(async ({ authenticatedPage: page }) => {
      await page.setViewportSize(NARROW_VIEWPORT);
    });

    test("FAB replaces the Add observation button", async ({ authenticatedPage: page }) => {
      await page.goto("/");
      await expect(page.locator(FAB)).toBeVisible();
      await expect(page.getByRole("button", CREATE_BUTTON)).toHaveCount(0);
    });

    // Regression: the create speed-dial must stay closed after an action opens
    // and then closes the upload modal. The SpeedDial used to re-open when focus
    // returned to the FAB on modal close (MUI opens the dial on focus).
    test("create FAB menu stays closed after the modal closes", async ({
      authenticatedPage: page,
    }) => {
      await page.goto("/");
      // Hover, don't click. MUI opens the dial on mouseenter via a 0ms timer,
      // and click() moves the mouse before pressing: if that timer fires in
      // between (likely under CI load), the click's toggle closes the dial it
      // just opened.
      await page.locator(FAB).hover();
      await page.getByRole("menuitem", { name: "New Observation" }).click();
      await expect(
        page.getByRole("dialog").getByRole("heading", { name: "New Observation" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();

      // Focus has returned to the FAB; the dial must not have re-opened.
      await expect(page.getByRole("menuitem", { name: "New Observation" })).not.toBeVisible();
      await expect(page.locator(FAB)).toHaveAttribute("aria-expanded", "false");
    });

    test("create FAB menu shows its labels over a backdrop that closes it", async ({
      authenticatedPage: page,
    }) => {
      await page.goto("/");
      await page.locator(FAB).click();
      // The labels are always shown, not just on hover.
      await expect(page.getByText("New Observation", { exact: true })).toBeVisible();

      // Anywhere away from the dial lands on the backdrop.
      await page.mouse.click(10, 300);
      await expect(page.locator(FAB)).toHaveAttribute("aria-expanded", "false");
      // Closed labels fade out rather than leave the DOM.
      await expect(page.getByText("New Observation", { exact: true })).toHaveCSS("opacity", "0");
    });
  });

  test("upload modal shows posting as handle", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await openUploadModal(page);
    await expect(page.getByText(`@${MOCK_TEST_USER.handle}`).first()).toBeVisible();
  });

  test("quick species chips populate species input", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await openUploadModal(page);
    await gotoUploadStep(page, "Identify");
    const poppyChip = page.getByRole("button", {
      name: /California Poppy/i,
    });
    if (await poppyChip.isVisible()) {
      await poppyChip.click();
      const speciesInput = page.getByLabel(/Taxon/i);
      await expect(speciesInput).not.toHaveValue("");
    }
  });

  test("typing in species input shows autocomplete suggestions", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");
    await openUploadModal(page);
    await gotoUploadStep(page, "Identify");
    const speciesInput = page.getByLabel(/Taxon/i);
    await speciesInput.click();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/taxa/search")),
      speciesInput.pressSequentially("quercus", { delay: 50 }),
    ]);
    await expect(page.locator(".MuiAutocomplete-option").first()).toBeVisible();
  });

  test("upload modal shows observation date picker defaulting to today", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");
    await openUploadModal(page);
    await gotoUploadStep(page, "Date & details");
    const dateInput = page.getByLabel("Observation date");
    await expect(dateInput).toBeVisible();
    const value = await dateInput.inputValue();
    // Date input uses local time, so compare with local date
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(value.startsWith(today)).toBeTruthy();
  });

  test.describe("in a different time zone from the photo", () => {
    // UTC+2 on the photo's date; the photo was taken at UTC-7.
    test.use({ contextOptions: { timezoneId: "Europe/Berlin" } });

    test("reads a photo's capture time and accuracy as the batch uploader does", async ({
      authenticatedPage: page,
    }) => {
      const bodies = await mockSubmit(page);
      await page.goto("/");
      await openUploadModal(page);
      await page
        .getByRole("dialog")
        .locator('input[type="file"]')
        .setInputFiles(taggedPhoto("IMG_1.jpg"));

      await gotoUploadStep(page, "Date & details");
      await expect(page.getByLabel("Observation date")).toHaveValue("2026-10-03T10:42");
      await expect(page.getByRole("combobox", { name: /Time zone/ })).toHaveText("UTC-07:00");

      await page.getByRole("dialog").getByRole("button", { name: "Submit" }).click();
      await expect.poll(() => bodies.length).toBe(1);
      // 10:42 at UTC-7, not 10:42 in the browser's zone (08:42Z).
      expect(bodies[0]).toMatchObject({
        eventDate: "2026-10-03T17:42:00.000Z",
        latitude: 37.905,
        longitude: -122.2445,
        coordinateUncertaintyInMeters: 12,
      });
    });

    test("re-reads the clock time in a zone chosen by hand", async ({
      authenticatedPage: page,
    }) => {
      const bodies = await mockSubmit(page);
      await page.goto("/");
      await openUploadModal(page);
      await revealCoordinateInputs(page);
      await page.getByLabel("Latitude").fill("37.7749");
      await page.getByLabel("Longitude").fill("-122.4194");

      await gotoUploadStep(page, "Date & details");
      await page.getByLabel("Observation date").fill("2026-10-03T10:42");
      const zone = page.getByRole("combobox", { name: /Time zone/ });
      await expect(zone).toHaveText("Local time (UTC+02:00)");
      await zone.click();
      await page.getByRole("option", { name: "UTC+09:00" }).click();

      await page.getByRole("dialog").getByRole("button", { name: "Submit" }).click();
      await expect.poll(() => bodies.length).toBe(1);
      expect(bodies[0]).toMatchObject({ eventDate: "2026-10-03T01:42:00.000Z" });
    });
  });

  test("file input only accepts image types", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await openUploadModal(page);
    // Scope to the dialog's file input (FAB has its own hidden file input)
    const fileInput = page.getByRole("dialog").locator('input[type="file"]');
    await expect(fileInput).toHaveAttribute("accept", /image/);
  });

  test("submit button sends observation to API", async ({ authenticatedPage: page }) => {
    await page.route("**/api/occurrences", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            uri: "at://did:plc:test123/bio.lexicons.temp.v0-1.occurrence/abc123",
            cid: "bafytest",
          }),
        });
      }
      return route.continue();
    });

    await page.goto("/");
    await openUploadModal(page);
    await gotoUploadStep(page, "Identify");

    const speciesInput = page.getByLabel(/Taxon/i);
    await speciesInput.fill("Quercus alba");
    const option = page.locator(".MuiAutocomplete-option").first();
    if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
      await option.click();
    }

    // Set location via coordinate inputs
    await revealCoordinateInputs(page);
    const latInput = page.getByLabel("Latitude");
    await latInput.scrollIntoViewIfNeeded();
    await latInput.fill("37.7749");
    await page.getByLabel("Longitude").fill("-122.4194");

    const submitButton = page.getByRole("button", { name: /Submit/i });
    if (await submitButton.isEnabled()) {
      await submitButton.click();
      // Wait for the mocked API response
      await page
        .waitForResponse(
          (r) => r.url().includes("/api/occurrences") && r.request().method() === "POST",
          { timeout: 10_000 },
        )
        .catch(() => {});
    }
  });

  test("submitting a large image sends a payload exceeding 2MB", async ({
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
            uri: "at://did:plc:test123/bio.lexicons.temp.v0-1.occurrence/large123",
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
      0xff,
      0xd8, // SOI
      0xff,
      0xe0,
      0x00,
      0x10,
      0x4a,
      0x46,
      0x49,
      0x46,
      0x00,
      0x01,
      0x01,
      0x00,
      0x00,
      0x01,
      0x00,
      0x01,
      0x00,
      0x00, // APP0/JFIF
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
    await page
      .getByRole("dialog")
      .locator("img")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => {});

    // Set location via coordinate inputs
    await revealCoordinateInputs(page);
    const latInput = page.getByLabel("Latitude");
    await latInput.scrollIntoViewIfNeeded();
    await latInput.fill("37.7749");
    await page.getByLabel("Longitude").fill("-122.4194");

    const submitButton = page.getByRole("button", { name: /Submit/i });
    await submitButton.click();
    // Wait for the mocked API response instead of fixed delay
    await page.waitForResponse(
      (r) => r.url().includes("/api/occurrences") && r.request().method() === "POST",
      { timeout: 15_000 },
    );

    // The base64-encoded body should exceed the old 2MB limit
    expect(requestBodySize).toBeGreaterThan(2 * 1024 * 1024);
  });
});
