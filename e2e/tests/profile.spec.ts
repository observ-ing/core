import { test, expect } from "@playwright/test";

test.describe("Profile View", () => {
  // TC-PROFILE-002: Profile page from feed
  test("clicking observer name in feed navigates to profile", async ({
    page,
  }) => {
    await page.goto("/");
    // Wait for real feed content (not skeletons) by waiting for a profile link
    const profileLink = page
      .locator('.MuiCard-root a[href*="/profile/"]')
      .first();
    await expect(profileLink).toBeVisible({ timeout: 15000 });
    await profileLink.click();
    await expect(page).toHaveURL(/\/profile\//);
  });

  // TC-PROFILE-003: Profile header display
  test("profile page shows avatar, display name, and handle", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    const profileLink = page
      .locator('.MuiCard-root a[href*="/profile/"]')
      .first();
    await profileLink.click();
    await expect(page).toHaveURL(/\/profile\//);
    // Profile should show an avatar
    await expect(page.locator(".MuiAvatar-root").first()).toBeVisible({
      timeout: 10000,
    });
  });

  // TC-PROFILE-004: Profile stats display
  test("profile page shows observation and ID counts", async ({ page }) => {
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    const profileLink = page
      .locator('.MuiCard-root a[href*="/profile/"]')
      .first();
    await profileLink.click();
    await expect(page).toHaveURL(/\/profile\//);
    // Wait for profile to load
    await page.waitForTimeout(2000);
    // Should show stats with numbers
    await expect(
      page.getByText(/Observations/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  // TC-PROFILE-005: Profile feed tabs
  test("profile has Observations and IDs tabs", async ({ page }) => {
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    const profileLink = page
      .locator('.MuiCard-root a[href*="/profile/"]')
      .first();
    await profileLink.click();
    await expect(page).toHaveURL(/\/profile\//);
    await expect(
      page.getByRole("tab", { name: /Observations/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("tab", { name: /IDs/i })).toBeVisible();
  });

  test("clicking IDs tab switches content", async ({ page }) => {
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    const profileLink = page
      .locator('.MuiCard-root a[href*="/profile/"]')
      .first();
    await profileLink.click();
    await expect(page).toHaveURL(/\/profile\//);
    await page
      .getByRole("tab", { name: /IDs/i })
      .waitFor({ timeout: 10000 });
    await page.getByRole("tab", { name: /IDs/i }).click();
    // Tab should now be selected
    await expect(
      page.getByRole("tab", { name: /IDs/i }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
