import { test, expect, type Page } from "@playwright/test";
import {
  buildMockObservation,
  mockOwnObservationFeed,
  mockObservationDetailRoute,
} from "./helpers/mock-observation";
import { mockJson } from "./helpers/mock-api";
import { MOCK_TEST_USER } from "./helpers/test-users";
import { openFirstCard } from "./helpers/navigation";
import type { ProfileFeedResponse } from "../src/services/types";

const PROFILE_FEED: ProfileFeedResponse = {
  profile: MOCK_TEST_USER,
  counts: { observations: 24, identifications: 51, species: 18 },
  occurrences: [buildMockObservation()],
  identifications: [],
};

/**
 * Navigate from explore grid to an observation detail page, then to the
 * observer's profile, and wait for the profile to load.
 */
async function navigateToProfile(page: Page) {
  await mockOwnObservationFeed(page);
  await mockObservationDetailRoute(page);
  await mockJson(page, "**/api/profiles/*/feed*", PROFILE_FEED);
  await page.goto("/explore");
  await openFirstCard(page);
  const profileLink = page.locator('a[href*="/profile/"]').first();
  await expect(profileLink).toBeVisible();
  await profileLink.click();
  await expect(page).toHaveURL(/\/profile\//);
  await expect(page.getByRole("heading", { name: MOCK_TEST_USER.displayName })).toBeVisible();
}

test.describe("Profile View", () => {
  test("clicking observer name navigates to profile", async ({ page }) => {
    await navigateToProfile(page);
  });

  test("profile page shows avatar, display name, and handle", async ({ page }) => {
    await navigateToProfile(page);
    const main = page.getByRole("main");
    await expect(main.locator(".MuiAvatar-root").first()).toBeVisible();
    await expect(main.getByText(`@${MOCK_TEST_USER.handle}`)).toBeVisible();
  });

  test("profile page shows observation, ID, and species counts", async ({ page }) => {
    await navigateToProfile(page);
    for (const count of ["24", "51", "18"]) {
      await expect(page.getByText(count, { exact: true })).toBeVisible();
    }
  });

  test("profile has Observations and IDs tabs", async ({ page }) => {
    await navigateToProfile(page);
    await expect(page.getByRole("tab", { name: "Observations" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "IDs" })).toBeVisible();
  });

  test("clicking IDs tab switches content", async ({ page }) => {
    await navigateToProfile(page);
    await page.getByRole("tab", { name: "IDs" }).click();
    await expect(page.getByRole("tab", { name: "IDs" })).toHaveAttribute("aria-selected", "true");
  });
});
