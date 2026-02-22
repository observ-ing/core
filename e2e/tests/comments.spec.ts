import { test, expect } from "@playwright/test";
import {
  test as authTest,
  expect as authExpect,
} from "../fixtures/auth";

/** Navigate from the feed to the first observation's detail page. */
async function navigateToDetail(page: any, expectFn: any) {
  await page.goto("/");
  const card = page
    .locator(".MuiCard-root .MuiCardActionArea-root")
    .first();
  await expectFn(card).toBeVisible({ timeout: 15000 });
  await card.click();
  await expectFn(page).toHaveURL(/\/observation\/.+\/.+/);
  await expectFn(page.getByText("Observed")).toBeVisible({ timeout: 10000 });
}

test.describe("Comments - Logged Out", () => {
  // TC-CMT-001: Login prompt for comments
  test("shows login prompt when logged out", async ({ page }) => {
    await navigateToDetail(page, expect);
    await expect(
      page.getByText("Log in to add a comment"),
    ).toBeVisible();
  });
});

authTest.describe("Comments - Logged In", () => {
  // TC-CMT-002: Add button opens comment form
  authTest(
    "Add button opens comment form",
    async ({ authenticatedPage: page }) => {
      await navigateToDetail(page, authExpect);
      // The "Add" button in the Discussion section
      const addBtn = page
        .locator("text=Discussion")
        .locator("..")
        .locator("..")
        .getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();

      await authExpect(page.getByLabel("Add a comment")).toBeVisible();
      await authExpect(
        page.getByPlaceholder("Share your thoughts, ask questions..."),
      ).toBeVisible();
    },
  );

  // TC-CMT-003: Cancel closes comment form
  authTest(
    "Cancel closes comment form",
    async ({ authenticatedPage: page }) => {
      await navigateToDetail(page, authExpect);
      const addBtn = page
        .locator("text=Discussion")
        .locator("..")
        .locator("..")
        .getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();
      await authExpect(page.getByLabel("Add a comment")).toBeVisible();

      await page.getByRole("button", { name: "Cancel" }).click();
      await authExpect(page.getByLabel("Add a comment")).not.toBeVisible();
    },
  );

  // TC-CMT-004: Post comment sends POST
  authTest(
    "posting comment sends POST with body text",
    async ({ authenticatedPage: page }) => {
      await page.route("**/api/comments", (route) => {
        if (route.request().method() === "POST") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ success: true }),
          });
        }
        return route.continue();
      });

      await navigateToDetail(page, authExpect);
      const addBtn = page
        .locator("text=Discussion")
        .locator("..")
        .locator("..")
        .getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();

      await page
        .getByPlaceholder("Share your thoughts, ask questions...")
        .fill("This is a test comment");

      const postRequest = page.waitForRequest(
        (req: any) =>
          req.method() === "POST" && req.url().includes("/api/comments"),
      );
      await page.getByRole("button", { name: "Post" }).click();
      const req = await postRequest;
      const body = JSON.parse(req.postData() || "{}");
      authExpect(body.body).toBe("This is a test comment");
    },
  );
});
