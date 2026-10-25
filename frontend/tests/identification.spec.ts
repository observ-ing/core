import type { Request } from "@playwright/test";
import { test, expect } from "./fixtures/mock-auth";
import { navigateToMockedDetail } from "./helpers/mock-observation";

import { mockJson } from "./helpers/mock-api";

test.describe("Identification - Logged In", () => {
  test("Agree button sends POST identification", async ({ authenticatedPage: page }) => {
    await mockJson(
      page,
      "**/api/identifications",
      { uri: "at://test/id/1", cid: "bafyid" },
      { method: "POST" },
    );
    await navigateToMockedDetail(page);
    const agreeBtn = page.getByRole("button", { name: "Agree" });
    await expect(agreeBtn).toBeVisible({ timeout: 10_000 });

    const postRequest = page.waitForRequest(
      (req: Request) => req.method() === "POST" && req.url().includes("/api/identifications"),
    );
    await agreeBtn.click();
    const req = await postRequest;
    const body = JSON.parse(req.postData() || "{}");
    expect(typeof body.scientificName).toBe("string");
    expect(body.scientificName.length).toBeGreaterThan(0);
  });

  test("Suggest Different ID button opens form with species input", async ({
    authenticatedPage: page,
  }) => {
    await navigateToMockedDetail(page);
    const suggestBtn = page.getByRole("button", {
      name: "Suggest Different ID",
    });
    await expect(suggestBtn).toBeVisible({ timeout: 10_000 });
    await suggestBtn.click();

    await expect(page.getByLabel("Taxon Name")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("submitting different ID sends POST with new scientificName", async ({
    authenticatedPage: page,
  }) => {
    await mockJson(
      page,
      "**/api/identifications",
      { uri: "at://test/id/1", cid: "bafyid" },
      { method: "POST" },
    );
    await navigateToMockedDetail(page);
    const suggestBtn = page.getByRole("button", {
      name: "Suggest Different ID",
    });
    await expect(suggestBtn).toBeVisible({ timeout: 10_000 });
    await suggestBtn.click();

    const taxonInput = page.getByLabel("Taxon Name");
    await taxonInput.fill("Quercus rubra");
    // Dismiss the autocomplete popper so it doesn't cover the Kingdom select.
    await taxonInput.press("Escape");

    // Free-form names that don't match a known taxon require a Kingdom,
    // matching the new-observation flow.
    await page.getByRole("combobox", { name: "Kingdom" }).click();
    await page.getByRole("option", { name: "Plants" }).click();

    const postRequest = page.waitForRequest(
      (req: Request) => req.method() === "POST" && req.url().includes("/api/identifications"),
    );
    await page.getByRole("button", { name: "Submit ID" }).click();
    const req = await postRequest;
    const body = JSON.parse(req.postData() || "{}");
    expect(body.scientificName).toBe("Quercus rubra");
    expect(body.kingdom).toBe("Plantae");
  });

  test("Cancel closes the suggest form", async ({ authenticatedPage: page }) => {
    await navigateToMockedDetail(page);
    const suggestBtn = page.getByRole("button", {
      name: "Suggest Different ID",
    });
    await expect(suggestBtn).toBeVisible({ timeout: 10_000 });
    await suggestBtn.click();
    await expect(page.getByLabel("Taxon Name")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Taxon Name")).not.toBeVisible();
  });
});
