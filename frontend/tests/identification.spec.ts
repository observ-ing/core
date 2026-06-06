import { type Page, type Request } from "@playwright/test";
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

authTest.describe("Identification - Logged In", () => {
  // TC-ID-001: Agree button posts an identification
  authTest("Agree button sends POST identification", async ({ authenticatedPage: page }) => {
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
      (req: Request) => req.method() === "POST" && req.url().includes("/api/identifications"),
    );
    await agreeBtn.click();
    const req = await postRequest;
    const body = JSON.parse(req.postData() || "{}");
    authExpect(typeof body.scientificName).toBe("string");
    authExpect(body.scientificName.length).toBeGreaterThan(0);
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

      await authExpect(page.getByLabel("Taxon Name")).toBeVisible({
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

      const taxonInput = page.getByLabel("Taxon Name");
      await taxonInput.fill("Quercus rubra");
      // Dismiss the autocomplete popper so it doesn't cover the Kingdom select.
      await taxonInput.press("Escape");

      // Free-form names that don't match a known taxon require a Kingdom,
      // matching the new-observation flow.
      await muiSelect(page, "Kingdom").click();
      await page.getByRole("option", { name: "Plants" }).click();

      const postRequest = page.waitForRequest(
        (req: Request) => req.method() === "POST" && req.url().includes("/api/identifications"),
      );
      await page.getByRole("button", { name: "Submit ID" }).click();
      const req = await postRequest;
      const body = JSON.parse(req.postData() || "{}");
      authExpect(body.scientificName).toBe("Quercus rubra");
      authExpect(body.kingdom).toBe("Plantae");
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
    await authExpect(page.getByLabel("Taxon Name")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await authExpect(page.getByLabel("Taxon Name")).not.toBeVisible();
  });
});
