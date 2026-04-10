import { type Page } from "@playwright/test";
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
async function navigateToDetail(page: any) {
  await navigateToMockedDetail(page);
}

authTest.describe("Identification - Logged In", () => {
  // TC-ID-001: Agree button sends agreement
  authTest("Agree button sends POST with isAgreement true", async ({ authenticatedPage: page }) => {
    await page.route("**/api/identifications", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ uri: "at://test/id/1", cid: "bafyid" }),
        });
      }
      return route.continue();
    });
    await navigateToDetail(page);
    const agreeBtn = page.getByRole("button", { name: "Agree" });
    await authExpect(agreeBtn).toBeVisible({ timeout: 10000 });

    const postRequest = page.waitForRequest(
      (req: any) => req.method() === "POST" && req.url().includes("/api/identifications"),
    );
    await agreeBtn.click();
    const req = await postRequest;
    const body = JSON.parse(req.postData() || "{}");
    authExpect(body.isAgreement).toBe(true);
  });

  // TC-ID-002: Suggest Different ID opens form
  authTest(
    "Suggest Different ID button opens form with species input",
    async ({ authenticatedPage: page }) => {
      await navigateToDetail(page);
      const suggestBtn = page.getByRole("button", {
        name: "Suggest Different ID",
      });
      await authExpect(suggestBtn).toBeVisible({ timeout: 10000 });
      await suggestBtn.click();

      await authExpect(page.getByLabel("Species Name")).toBeVisible({
        timeout: 10000,
      });
    },
  );

  // TC-ID-003: Submit different ID sends POST
  authTest(
    "submitting different ID sends POST with new scientificName",
    async ({ authenticatedPage: page }) => {
      await page.route("**/api/identifications", (route) => {
        if (route.request().method() === "POST") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ uri: "at://test/id/1", cid: "bafyid" }),
          });
        }
        return route.continue();
      });
      await navigateToDetail(page);
      const suggestBtn = page.getByRole("button", {
        name: "Suggest Different ID",
      });
      await authExpect(suggestBtn).toBeVisible({ timeout: 10000 });
      await suggestBtn.click();

      const speciesInput = page.getByLabel("Species Name");
      await speciesInput.fill("Quercus rubra");

      const postRequest = page.waitForRequest(
        (req: any) => req.method() === "POST" && req.url().includes("/api/identifications"),
      );
      await page.getByRole("button", { name: "Submit ID" }).click();
      const req = await postRequest;
      const body = JSON.parse(req.postData() || "{}");
      authExpect(body.scientificName).toBe("Quercus rubra");
      authExpect(body.isAgreement).toBe(false);
    },
  );

  // TC-ID-004: Cancel closes the suggest form
  authTest("Cancel closes the suggest form", async ({ authenticatedPage: page }) => {
    await navigateToDetail(page);
    const suggestBtn = page.getByRole("button", {
      name: "Suggest Different ID",
    });
    await authExpect(suggestBtn).toBeVisible({ timeout: 10000 });
    await suggestBtn.click();
    await authExpect(page.getByLabel("Species Name")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await authExpect(page.getByLabel("Species Name")).not.toBeVisible();
  });

  // TC-ID-005: Add Another Organism shows info box
  authTest(
    "Add Another Organism shows info box with next subject index",
    async ({ authenticatedPage: page }) => {
      await navigateToDetail(page);
      const addOrgBtn = page.getByRole("button", {
        name: "Add Another Organism",
      });
      await authExpect(addOrgBtn).toBeVisible({ timeout: 10000 });
      await addOrgBtn.click();

      await authExpect(page.getByText(/Adding organism #\d+/)).toBeVisible();
      await authExpect(page.getByLabel("Species Name")).toBeVisible();
    },
  );
});
