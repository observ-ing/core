import { test, expect, type Page, type Request } from "@playwright/test";
import { test as authTest, expect as authExpect } from "./fixtures/mock-auth";
import { navigateToMockedDetail } from "./helpers/mock-observation";

/**
 * MUI v7 Select doesn't link labels via aria-labelledby.
 * Find by traversing from the label to the parent FormControl.
 */
function muiSelect(page: Page, label: string) {
  return page
    .locator(".MuiFormControl-root", {
      has: page.locator("label", { hasText: label }),
    })
    .getByRole("combobox");
}

/** Navigate to the mock observation detail page. */
async function navigateToDetail(page: Page) {
  await navigateToMockedDetail(page);
}

test.describe("Interactions - Logged Out", () => {
  // TC-INT-001: Login prompt
  test("shows login prompt when logged out", async ({ page }) => {
    await navigateToDetail(page);
    await expect(page.getByText("Log in to add interactions")).toBeVisible();
  });
});

authTest.describe("Interactions - Logged In", () => {
  // TC-INT-002: Section visible
  authTest("Species Interactions section is visible", async ({ authenticatedPage: page }) => {
    await navigateToDetail(page);
    await authExpect(page.getByText("Species Interactions")).toBeVisible();
  });

  // TC-INT-003: Add button opens form
  authTest("Add button opens interaction form", async ({ authenticatedPage: page }) => {
    await navigateToDetail(page);
    // Find the Add button near the Species Interactions heading
    const addBtn = page
      .getByRole("heading", { name: "Species Interactions" })
      .locator("xpath=ancestor::div[1]")
      .getByRole("button", { name: "Add" });
    await authExpect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click();

    await authExpect(page.getByLabel("Other organism (Subject B)")).toBeVisible({ timeout: 10000 });
    await authExpect(muiSelect(page, "Interaction Type")).toBeVisible();
    await authExpect(muiSelect(page, "Direction")).toBeVisible();
  });

  // TC-INT-004: Submit interaction hits real API
  authTest(
    "submitting interaction sends POST with correct data",
    async ({ authenticatedPage: page }) => {
      await page.route("**/api/interactions", (route) => {
        if (route.request().method() === "POST") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ uri: "at://test/int/1", cid: "bafyint" }),
          });
        }
        return route.continue();
      });
      await navigateToDetail(page);
      const addBtn = page
        .getByRole("heading", { name: "Species Interactions" })
        .locator("xpath=ancestor::div[1]")
        .getByRole("button", { name: "Add" });
      await authExpect(addBtn).toBeVisible({ timeout: 10000 });
      await addBtn.click();

      await page.getByLabel("Other organism (Subject B)").fill("Apis mellifera");

      const postRequest = page.waitForRequest(
        (req: Request) => req.method() === "POST" && req.url().includes("/api/interactions"),
      );
      await page.getByRole("button", { name: "Add Interaction" }).click();
      const req = await postRequest;
      const body = JSON.parse(req.postData() || "{}");
      authExpect(body.subjectB.scientificName).toBe("Apis mellifera");
    },
  );

  // TC-INT-005: Cancel closes form
  authTest("Cancel closes the interaction form", async ({ authenticatedPage: page }) => {
    await navigateToDetail(page);
    const addBtn = page
      .getByRole("heading", { name: "Species Interactions" })
      .locator("xpath=ancestor::div[1]")
      .getByRole("button", { name: "Add" });
    await authExpect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click();
    await authExpect(page.getByLabel("Other organism (Subject B)")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Cancel" }).click();
    await authExpect(page.getByLabel("Other organism (Subject B)")).not.toBeVisible();
  });
});
