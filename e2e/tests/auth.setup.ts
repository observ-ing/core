import { test as setup, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

const AUTH_FILE = resolve("playwright/.auth/user.json");
const USER_INFO_FILE = resolve("playwright/.auth/user-info.json");
const AUTH_DIR = dirname(AUTH_FILE);

const TEST_HANDLE = "testobserving.bsky.social";

setup("authenticate via Bluesky OAuth", async ({ page }) => {
  const email = process.env.BLUESKY_TEST_EMAIL;
  const password = process.env.BLUESKY_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "BLUESKY_TEST_EMAIL and BLUESKY_TEST_PASSWORD env vars are required to run e2e tests",
    );
  }

  mkdirSync(AUTH_DIR, { recursive: true });

  // 1. Navigate to the app
  await page.goto("/");

  // 2. Open the login modal
  await page.getByText("Log in").first().click();
  await expect(page.getByLabel("Your handle")).toBeVisible();

  // 3. Enter the test handle and submit
  await page.getByLabel("Your handle").fill(TEST_HANDLE);
  await page.getByRole("button", { name: "Continue" }).click();

  // 4. The app redirects to Bluesky's OAuth authorization page.
  //    Wait for navigation away from our app.
  await page.waitForURL(/(?!.*127\.0\.0\.1).*/, { timeout: 15000 });

  // 5. Handle the Bluesky sign-in page.
  //    The identifier is pre-filled and disabled. Just fill the password.
  const passwordField = page.locator('input[name="password"]');
  await expect(passwordField).toBeVisible({ timeout: 10000 });
  await passwordField.fill(password);

  // 6. Click "Sign in"
  await page.getByRole("button", { name: "Sign in" }).click();

  // 7. After sign-in, Bluesky shows an authorization prompt.
  //    Wait for the "Authorize" button and click it.
  const authorizeButton = page.getByRole("button", { name: "Authorize" });
  await expect(authorizeButton).toBeVisible({ timeout: 15000 });
  await authorizeButton.click();

  // 8. Wait for redirect back to our app
  await page.waitForURL(/127\.0\.0\.1/, { timeout: 30000 });

  // 9. Verify we're authenticated — the sidebar should show the test user
  await expect(page.getByText(`@${TEST_HANDLE}`).first()).toBeVisible({ timeout: 10000 });

  // 10. Fetch user info from /oauth/me
  const userInfo = await page.evaluate(async () => {
    const res = await fetch("/oauth/me", { credentials: "include" });
    const data = await res.json();
    return data.user;
  });

  if (userInfo) {
    writeFileSync(USER_INFO_FILE, JSON.stringify(userInfo, null, 2));
    console.log(`Authenticated as ${userInfo.handle} (${userInfo.did})`);
  }

  // 11. Save the authenticated state
  await page.context().storageState({ path: AUTH_FILE });
});
