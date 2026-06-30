import { test as setup, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

/**
 * Authenticates against the local @atproto/dev-env PDS (not bsky.social), so
 * the e2e run is fully isolated from the public network.
 *
 * Writes the same files as auth.setup.ts (playwright/.auth/user.json +
 * user-info.json), so e2e.spec.ts and the auth fixture work unchanged.
 *
 * Credentials come from scripts/e2e-devenv.ts via DEVENV_HANDLE / DEVENV_PASSWORD.
 *
 * The PDS sign-in/consent UI is @atproto/oauth-provider-ui. Selectors below are
 * taken from its source (sign-in-form.tsx: input[name=username|password],
 * "Sign in"; consent-form.tsx: "Authorize").
 */

const AUTH_FILE = resolve("playwright/.auth/user.json");
const USER_INFO_FILE = resolve("playwright/.auth/user-info.json");
const AUTH_DIR = dirname(AUTH_FILE);

setup("authenticate via dev-env PDS OAuth", async ({ page }) => {
  const handle = process.env.DEVENV_HANDLE;
  const password = process.env.DEVENV_PASSWORD;

  if (!handle || !password) {
    throw new Error(
      "DEVENV_HANDLE and DEVENV_PASSWORD must be set — run via scripts/e2e-devenv.ts",
    );
  }

  mkdirSync(AUTH_DIR, { recursive: true });

  // 1. Navigate to the app and open the login modal.
  await page.goto("/");
  await page.getByText("Log in").first().click();
  await expect(page.getByLabel("Your handle")).toBeVisible();

  // 2. Enter the test handle and submit.
  await page.getByLabel("Your handle").fill(handle);
  await page.getByRole("button", { name: "Continue" }).click();

  // 3. App redirects to the dev-env PDS authorization server. The PDS binds to
  //    `localhost:<random-port>` (e.g. http://localhost:56868) while the app is
  //    served at 127.0.0.1:3000 — so wait for the navigation to leave the app's
  //    own origin, not for a non-localhost host (the PDS *is* on localhost).
  //    Predicate form — a negative-lookahead regex would match immediately; see
  //    auth.setup.ts.
  await page.waitForURL((url) => !(url.hostname === "127.0.0.1" && url.port === "3000"), {
    timeout: 15000,
  });
  await page.waitForLoadState("domcontentloaded");

  // 4. dev-env PDS sign-in form. The username may be pre-filled from the OAuth
  //    login hint; fill it only when empty.
  const usernameField = page.locator('input[name="username"]');
  await expect(usernameField).toBeVisible({ timeout: 15000 });
  if (!(await usernameField.inputValue())) {
    await usernameField.fill(handle);
  }
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // 5. Consent screen — grant access.
  const authorizeButton = page.getByRole("button", { name: "Authorize" });
  await expect(authorizeButton).toBeVisible({ timeout: 15000 });
  await authorizeButton.click();

  // 6. Back to our app.
  await page.waitForURL(/127\.0\.0\.1/, { timeout: 30000 });
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({
    timeout: 10000,
  });

  // 7. Persist auth state for e2e.spec.ts.
  const userInfo = await page.evaluate(async () => {
    const res = await fetch("/oauth/me", { credentials: "include" });
    const data = await res.json();
    return data.user;
  });
  if (userInfo) {
    writeFileSync(USER_INFO_FILE, JSON.stringify(userInfo, null, 2));
    console.log(`Authenticated as ${userInfo.handle} (${userInfo.did})`);
  }
  await page.context().storageState({ path: AUTH_FILE });
});
