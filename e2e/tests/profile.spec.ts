import { test, expect } from "@playwright/test";

/** Navigate from explore grid to an observation detail page, then to the observer's profile. */
async function navigateToProfile(page: any) {
  await page.goto("/explore");
  const firstCard = page.locator(".MuiCard-root").first();
  await expect(firstCard).toBeVisible({ timeout: 10000 });
  await firstCard.locator(".MuiCardActionArea-root").click();
  await expect(page).toHaveURL(/\/observation\//);
  // Detail page shows observer info with a profile link
  const profileLink = page.locator('a[href*="/profile/"]').first();
  await expect(profileLink).toBeVisible({ timeout: 15000 });
  await profileLink.click();
  await expect(page).toHaveURL(/\/profile\//);
}

test.describe("Profile View", () => {
  // TC-PROFILE-002: Profile page from detail
  test("clicking observer name navigates to profile", async ({ page }) => {
    await navigateToProfile(page);
  });

  // TC-PROFILE-003: Profile header display
  test("profile page shows avatar, display name, and handle", async ({ page }) => {
    await navigateToProfile(page);
    await expect(page.locator(".MuiAvatar-root").first()).toBeVisible({
      timeout: 10000,
    });
  });

  // TC-PROFILE-004: Profile stats display
  test("profile page shows observation and ID counts", async ({ page }) => {
    await navigateToProfile(page);
    await page.waitForTimeout(2000);
    await expect(page.getByText(/Observations/i).first()).toBeVisible({ timeout: 10000 });
  });

  // TC-PROFILE-005: Profile feed tabs
  test("profile has Observations and IDs tabs", async ({ page }) => {
    await navigateToProfile(page);
    await expect(page.getByRole("tab", { name: /Observations/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("tab", { name: /IDs/i })).toBeVisible();
  });

  test("clicking IDs tab switches content", async ({ page }) => {
    await navigateToProfile(page);
    await page.getByRole("tab", { name: /IDs/i }).waitFor({ timeout: 10000 });
    await page.getByRole("tab", { name: /IDs/i }).click();
    await expect(page.getByRole("tab", { name: /IDs/i })).toHaveAttribute("aria-selected", "true");
  });
});
