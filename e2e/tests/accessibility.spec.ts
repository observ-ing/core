import { test, expect } from "@playwright/test";
import {
  test as authTest,
  expect as authExpect,
} from "../fixtures/auth";

const FAB = 'button[aria-label="Create actions"]';

test.describe("Accessibility", () => {
  // TC-A11Y-001: Keyboard navigation
  test("tab navigates through interactive elements", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toBeVisible();
  });

  // TC-A11Y-002: Modal escape key
  test("pressing Escape closes login modal", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Log in" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});

authTest.describe("Accessibility - Authenticated", () => {
  // TC-A11Y-002: Modal escape key (upload modal)
  authTest(
    "pressing Escape closes upload modal",
    async ({ authenticatedPage: page }) => {
      await page.goto("/");
      await page.locator(FAB).waitFor({ timeout: 5000 });
      await page.locator(FAB).click();
      const newObsAction = page.getByRole("menuitem", {
        name: "New Observation",
      });
      await newObsAction.waitFor({ state: "visible", timeout: 3000 });
      await newObsAction.click();
      await page.waitForTimeout(500);
      // Verify modal is open by checking for the species input
      await authExpect(page.getByLabel(/Species/i)).toBeVisible({
        timeout: 5000,
      });
      await page.keyboard.press("Escape");
      await authExpect(page.getByLabel(/Species/i)).not.toBeVisible();
    },
  );

  // TC-A11Y-003: Autocomplete keyboard navigation
  authTest(
    "arrow keys navigate autocomplete suggestions",
    async ({ authenticatedPage: page }) => {
      await page.goto("/");
      await page.locator(FAB).waitFor({ timeout: 5000 });
      await page.locator(FAB).click();
      const newObsAction = page.getByRole("menuitem", {
        name: "New Observation",
      });
      await newObsAction.waitFor({ state: "visible", timeout: 3000 });
      await newObsAction.click();
      await page.waitForTimeout(500);

      const speciesInput = page.getByLabel(/Species/i);
      await speciesInput.fill("quercus");
      const popper = page.locator(".MuiAutocomplete-popper");
      await authExpect(popper).toBeVisible({ timeout: 5000 });

      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await authExpect(speciesInput).not.toHaveValue("quercus");
    },
  );
});
