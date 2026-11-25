import type { Page } from "@playwright/test";
import type { InatAccountResponse } from "../../src/bindings/InatAccountResponse";

export const LINKED: InatAccountResponse = {
  enabled: true,
  login: "kueda",
  linkedAt: "2026-10-07T00:00:00Z",
};
export const UNLINKED: InatAccountResponse = { enabled: true, login: null, linkedAt: null };
export const DISABLED: InatAccountResponse = { enabled: false, login: null, linkedAt: null };

/** Answers GET /api/inat/account with `account`, and any change to it with success. */
export async function mockAccount(page: Page, account: InatAccountResponse) {
  await page.route("**/api/inat/account", (route) =>
    route.fulfill({ json: route.request().method() === "GET" ? account : { success: true } }),
  );
}
