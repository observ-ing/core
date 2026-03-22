import { test, expect } from "@playwright/test";
import { test as authTest, expect as authExpect } from "./fixtures/mock-auth";
import { navigateToMockedDetail } from "./helpers/mock-observation";

/** Navigate to the mock observation detail page. */
async function navigateToDetail(page: any, _expectFn: any) {
  await navigateToMockedDetail(page);
}

test.describe("Comments - Logged Out", () => {
  // TC-CMT-001: Login prompt for comments
  test("shows login prompt when logged out", async ({ page }) => {
    await navigateToDetail(page, expect);
    await expect(page.getByText("Log in to add a comment")).toBeVisible();
  });
});

authTest.describe("Comments - Logged In", () => {
  // TC-CMT-002: Add button opens comment form
  authTest("Add button opens comment form", async ({ authenticatedPage: page }) => {
    await navigateToDetail(page, authExpect);
    const addBtn = page
      .locator("text=Discussion")
      .locator("..")
      .locator("..")
      .getByRole("button", { name: "Add" });
    await authExpect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click();

    await authExpect(page.getByLabel("Add a comment")).toBeVisible();
    await authExpect(page.getByPlaceholder("Share your thoughts, ask questions...")).toBeVisible();
  });

  // TC-CMT-003: Cancel closes comment form
  authTest("Cancel closes comment form", async ({ authenticatedPage: page }) => {
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
  });

  // TC-CMT-004: Post comment hits real API
  authTest("posting comment sends POST with body text", async ({ authenticatedPage: page }) => {
    await page.route("**/api/comments", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ uri: "at://test/comment/1", cid: "bafycomment" }),
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
      (req: any) => req.method() === "POST" && req.url().includes("/api/comments"),
    );
    await page.getByRole("button", { name: "Post" }).click();
    const req = await postRequest;
    const body = JSON.parse(req.postData() || "{}");
    authExpect(body.body).toBe("This is a test comment");
  });
});
