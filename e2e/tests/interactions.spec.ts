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

test.describe("Interactions - Logged Out", () => {
  // TC-INT-001: Login prompt
  test("shows login prompt when logged out", async ({ page }) => {
    await navigateToDetail(page, expect);
    await expect(
      page.getByText("Log in to add interactions"),
    ).toBeVisible();
  });
});

authTest.describe("Interactions - Logged In", () => {
  // TC-INT-002: Section visible
  authTest(
    "Species Interactions section is visible",
    async ({ authenticatedPage: page }) => {
      await navigateToDetail(page, authExpect);
      await authExpect(
        page.getByText("Species Interactions"),
      ).toBeVisible();
    },
  );

  // TC-INT-003: Add button opens form
  authTest(
    "Add button opens interaction form",
    async ({ authenticatedPage: page }) => {
      await navigateToDetail(page, authExpect);
      // Find the Add button near the Species Interactions heading
      const addBtn = page
        .getByRole("heading", { name: "Species Interactions" })
        .locator("xpath=ancestor::div[1]")
        .getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();

      await authExpect(
        page.getByLabel("Other organism (Subject B)"),
      ).toBeVisible({ timeout: 10000 });
      await authExpect(
        page.getByRole("combobox", { name: "Interaction Type" }),
      ).toBeVisible();
      await authExpect(
        page.getByRole("combobox", { name: "Direction" }),
      ).toBeVisible();
      await authExpect(
        page.getByRole("combobox", { name: "Confidence" }),
      ).toBeVisible();
    },
  );

  // TC-INT-004: Submit interaction hits real API
  authTest(
    "submitting interaction sends POST with correct data",
    async ({ authenticatedPage: page }) => {
      await navigateToDetail(page, authExpect);
      const addBtn = page
        .getByRole("heading", { name: "Species Interactions" })
        .locator("xpath=ancestor::div[1]")
        .getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();

      await page
        .getByLabel("Other organism (Subject B)")
        .fill("Apis mellifera");

      const postRequest = page.waitForRequest(
        (req: any) =>
          req.method() === "POST" &&
          req.url().includes("/api/interactions"),
      );
      await page
        .getByRole("button", { name: "Add Interaction" })
        .click();
      const req = await postRequest;
      const body = JSON.parse(req.postData() || "{}");
      authExpect(body.subjectB.scientificName).toBe("Apis mellifera");
    },
  );

  // TC-INT-005: Cancel closes form
  authTest(
    "Cancel closes the interaction form",
    async ({ authenticatedPage: page }) => {
      await navigateToDetail(page, authExpect);
      const addBtn = page
        .getByRole("heading", { name: "Species Interactions" })
        .locator("xpath=ancestor::div[1]")
        .getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();
      await authExpect(
        page.getByLabel("Other organism (Subject B)"),
      ).toBeVisible({ timeout: 10000 });

      await page.getByRole("button", { name: "Cancel" }).click();
      await authExpect(
        page.getByLabel("Other organism (Subject B)"),
      ).not.toBeVisible();
    },
  );
});
