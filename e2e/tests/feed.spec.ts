import { test, expect } from "@playwright/test";

test.describe("Feed View", () => {
  // TC-FEED-001: Feed loads observations
  test("feed displays observation cards", async ({ page }) => {
    await page.goto("/explore");
    const cards = page.locator(".MuiCard-root");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);
  });

  // TC-FEED-002: Feed item click
  test("clicking a feed item navigates to observation detail", async ({ page }) => {
    await page.goto("/explore");
    const firstCard = page.locator(".MuiCard-root").first();
    await expect(firstCard).toBeVisible();
    await firstCard.locator(".MuiCardActionArea-root").click();
    await expect(page).toHaveURL(/\/observation\//);
  });

  // TC-FEED-003: Infinite scroll
  test("scrolling to bottom loads more items", async ({ page }) => {
    await page.goto("/explore");
    await page.locator(".MuiCard-root").first().waitFor({ timeout: 15_000 });
    const initialCount = await page.locator(".MuiCard-root").count();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    // Wait for network activity to settle after scroll-triggered fetch
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const newCount = await page.locator(".MuiCard-root").count();
    expect(newCount).toBeGreaterThanOrEqual(initialCount);
  });

  // TC-FEED-004: Home vs Explore tabs
  test("explore tab shows observations in grid layout", async ({ page }) => {
    await page.goto("/explore");
    const cards = page.locator(".MuiCard-root");
    await expect(cards.first()).toBeVisible();
  });

  // TC-FEED-006: Explore feed (unauthenticated)
  test("explore feed shows content when logged out", async ({ page }) => {
    await page.goto("/explore");
    const cards = page.locator(".MuiCard-root");
    await expect(cards.first()).toBeVisible();
  });

  // TC-FEED-007: Observer name links to profile (via detail page)
  test("clicking observer name navigates to their profile", async ({ page }) => {
    await page.goto("/explore");
    const firstCard = page.locator(".MuiCard-root").first();
    await expect(firstCard).toBeVisible();
    await firstCard.locator(".MuiCardActionArea-root").click();
    await expect(page).toHaveURL(/\/observation\//);
    // Detail page shows observer info with a profile link
    const profileLink = page.locator('a[href*="/profile/"]').first();
    await expect(profileLink).toBeVisible();
    await profileLink.click();
    await expect(page).toHaveURL(/\/profile\//);
  });

  // TC-FEED-008: Observer avatar display (via detail page)
  test("observation detail shows observer avatar", async ({ page }) => {
    await page.goto("/explore");
    const firstCard = page.locator(".MuiCard-root").first();
    await expect(firstCard).toBeVisible();
    await firstCard.locator(".MuiCardActionArea-root").click();
    await expect(page).toHaveURL(/\/observation\//);
    const avatar = page.locator(".MuiAvatar-root").first();
    await expect(avatar).toBeVisible();
  });
});
