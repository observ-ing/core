import type { Request } from "@playwright/test";
import { test, expect } from "./fixtures/mock-auth";
import { navigateToMockedDetail } from "./helpers/mock-observation";
import { mockJson } from "./helpers/mock-api";

test.describe("Comments - Logged Out", () => {
  test("shows login prompt when logged out", async ({ page }) => {
    await navigateToMockedDetail(page);
    await expect(page.getByText("Log in to add a comment")).toBeVisible();
  });
});

test.describe("Comments - Logged In", () => {
  test("Add button opens comment form", async ({ authenticatedPage: page }) => {
    await navigateToMockedDetail(page);
    const addBtn = page
      .locator("text=Discussion")
      .locator("..")
      .locator("..")
      .getByRole("button", { name: "Add" });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    await expect(page.getByLabel("Add a comment")).toBeVisible();
    await expect(page.getByPlaceholder("Share your thoughts, ask questions...")).toBeVisible();
  });

  test("Cancel closes comment form", async ({ authenticatedPage: page }) => {
    await navigateToMockedDetail(page);
    const addBtn = page
      .locator("text=Discussion")
      .locator("..")
      .locator("..")
      .getByRole("button", { name: "Add" });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();
    await expect(page.getByLabel("Add a comment")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Add a comment")).not.toBeVisible();
  });

  test("posting comment sends POST with body text", async ({ authenticatedPage: page }) => {
    await mockJson(
      page,
      "**/api/comments",
      { uri: "at://test/comment/1", cid: "bafycomment" },
      { method: "POST" },
    );
    await navigateToMockedDetail(page);
    const addBtn = page
      .locator("text=Discussion")
      .locator("..")
      .locator("..")
      .getByRole("button", { name: "Add" });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    await page
      .getByPlaceholder("Share your thoughts, ask questions...")
      .fill("This is a test comment");

    const postRequest = page.waitForRequest(
      (req: Request) => req.method() === "POST" && req.url().includes("/api/comments"),
    );
    await page.getByRole("button", { name: "Post" }).click();
    const req = await postRequest;
    const body = JSON.parse(req.postData() || "{}");
    expect(body.body).toBe("This is a test comment");
  });
});
