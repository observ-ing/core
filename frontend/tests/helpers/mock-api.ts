import type { Page } from "@playwright/test";

/**
 * Answers requests to `url` with `json`. With `method`, requests of other
 * methods fall back to routes registered earlier, then to the integration
 * server, which answers 404.
 */
export async function mockJson(
  page: Page,
  url: string,
  json: unknown,
  { method, status = 200 }: { method?: string; status?: number } = {},
) {
  await page.route(url, (route) =>
    method && route.request().method() !== method
      ? route.fallback()
      : route.fulfill({ status, json }),
  );
}
