import { test, expect, type Page, type Route } from "@playwright/test";
import { mockOwnObservationFeed, mockObservationDetailRoute } from "./helpers/mock-observation";

/** Navigate from explore grid to an observation detail page, then to the observer's profile. */
async function navigateToProfile(page: Page) {
  await mockOwnObservationFeed(page);
  await mockObservationDetailRoute(page);
  await page.route("**/api/profiles/*", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        did: "did:plc:mocktest",
        handle: "testuser.bsky.social",
        displayName: "Test User",
        observationCount: 3,
        identificationCount: 1,
      }),
    }),
  );
  await page.route("**/api/feeds/profile/**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ occurrences: [], cursor: null }),
    }),
  );
  await page.route("**/api/identifications/by-observer/**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ identifications: [], cursor: null }),
    }),
  );
  await page.goto("/explore");
  const firstCard = page.locator(".MuiCard-root").first();
  await expect(firstCard).toBeVisible({ timeout: 10_000 });
  await firstCard.locator(".MuiCardActionArea-root").click();
  await expect(page).toHaveURL(/\/observation\//);
  const profileLink = page.locator('a[href*="/profile/"]').first();
  await expect(profileLink).toBeVisible();
  await profileLink.click();
  await expect(page).toHaveURL(/\/profile\//);
}

test.describe("Profile View", () => {
  test("clicking observer name navigates to profile", async ({ page }) => {
    await navigateToProfile(page);
  });

  test("profile page shows avatar, display name, and handle", async ({ page }) => {
    await navigateToProfile(page);
    await expect(page.locator(".MuiAvatar-root").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("profile page shows observation and ID counts", async ({ page }) => {
    await navigateToProfile(page);
    await expect(page.getByText(/Observations/i).first()).toBeVisible();
  });

  test("profile has Observations and IDs tabs", async ({ page }) => {
    await navigateToProfile(page);
    await expect(page.getByRole("tab", { name: /Observations/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("tab", { name: /IDs/i })).toBeVisible();
  });

  test("clicking IDs tab switches content", async ({ page }) => {
    await navigateToProfile(page);
    await page.getByRole("tab", { name: /IDs/i }).waitFor({ timeout: 10_000 });
    await page.getByRole("tab", { name: /IDs/i }).click();
    await expect(page.getByRole("tab", { name: /IDs/i })).toHaveAttribute("aria-selected", "true");
  });
});
