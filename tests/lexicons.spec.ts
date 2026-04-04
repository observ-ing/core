import { test, expect } from "@playwright/test";

test.describe("Lexicons page", () => {
  test("renders lexicon schema cards", async ({ page }) => {
    await page.goto("/lexicons");
    await expect(page.getByRole("heading", { name: "Project Lexicons" })).toBeVisible();
    // At least one project lexicon card should render (not an empty list)
    const cards = page.locator(".MuiCard-root");
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
