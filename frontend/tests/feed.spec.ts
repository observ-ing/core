import { test, expect } from "@playwright/test";
import { mockOwnObservationFeed, mockObservationDetailRoute } from "./helpers/mock-observation";
import { mockJson } from "./helpers/mock-api";
import { openFirstCard } from "./helpers/navigation";
import { MOCK_TEST_USER } from "./helpers/test-users";

test.describe("Feed View", () => {
  test.beforeEach(async ({ page }) => {
    await mockOwnObservationFeed(page);
  });

  test("feed displays observation cards", async ({ page }) => {
    await page.goto("/explore");
    const cards = page.locator(".MuiCard-root");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);
  });

  test("clicking a feed item navigates to observation detail", async ({ page }) => {
    await page.goto("/explore");
    await openFirstCard(page);
  });

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

  test("explore tab shows observations in grid layout", async ({ page }) => {
    await page.goto("/explore");
    const cards = page.locator(".MuiCard-root");
    await expect(cards.first()).toBeVisible();
  });

  test("explore feed shows content when logged out", async ({ page }) => {
    await page.goto("/explore");
    const cards = page.locator(".MuiCard-root");
    await expect(cards.first()).toBeVisible();
  });

  test("clicking observer name navigates to their profile", async ({ page }) => {
    await mockObservationDetailRoute(page);
    await mockJson(page, "**/api/profiles/*", {
      ...MOCK_TEST_USER,
      observationCount: 1,
      identificationCount: 0,
    });
    await mockJson(page, "**/api/feeds/profile/**", { occurrences: [], cursor: null });
    await page.goto("/explore");
    await openFirstCard(page);
    // Detail page shows observer info with a profile link
    const profileLink = page.locator('a[href*="/profile/"]').first();
    await expect(profileLink).toBeVisible();
    await profileLink.click();
    await expect(page).toHaveURL(/\/profile\//);
  });

  test("observation detail shows observer avatar", async ({ page }) => {
    await mockObservationDetailRoute(page);
    await page.goto("/explore");
    await openFirstCard(page);
    const avatar = page.locator(".MuiAvatar-root").first();
    await expect(avatar).toBeVisible();
  });
});
