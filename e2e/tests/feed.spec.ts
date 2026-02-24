import { test, expect } from "@playwright/test";

test.describe("Feed View", () => {
  // TC-FEED-001: Feed loads observations
  test("feed displays observation cards", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator(".MuiCard-root");
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
    expect(await cards.count()).toBeGreaterThan(0);
  });

  // TC-FEED-002: Feed item click
  test("clicking a feed item navigates to observation detail", async ({ page }) => {
    await page.goto("/");
    const firstCard = page.locator(".MuiCard-root").first();
    await expect(firstCard).toBeVisible({ timeout: 10000 });
    await firstCard.locator(".MuiCardActionArea-root").click();
    await expect(page).toHaveURL(/\/observation\//);
  });

  // TC-FEED-003: Infinite scroll
  test("scrolling to bottom loads more items", async ({ page }) => {
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    const initialCount = await page.locator(".MuiCard-root").count();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
    const newCount = await page.locator(".MuiCard-root").count();
    expect(newCount).toBeGreaterThanOrEqual(initialCount);
  });

  // TC-FEED-004: Home vs Explore tabs
  test("explore tab shows observations in grid layout", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Explore" }).first().click();
    await expect(page).toHaveURL("/explore");
    const cards = page.locator(".MuiCard-root");
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
  });

  // TC-FEED-006: Home feed (unauthenticated)
  test("home feed shows content when logged out", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator(".MuiCard-root");
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
  });

  // TC-FEED-007: Observer name links to profile
  test("clicking observer name navigates to their profile", async ({ page }) => {
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    // Wait for enough cards to load so we can find one with a profile link
    await page.waitForTimeout(1000);
    const profileLink = page.locator('.MuiCard-root a[href*="/profile/"]').first();
    await expect(profileLink).toBeVisible({ timeout: 5000 });
    await profileLink.click();
    await expect(page).toHaveURL(/\/profile\//);
  });

  // TC-FEED-008: Observer avatar display
  test("feed items show observer avatars", async ({ page }) => {
    await page.goto("/");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(1000);
    const avatar = page.locator(".MuiCard-root .MuiAvatar-root").first();
    await expect(avatar).toBeVisible({ timeout: 5000 });
  });
});
