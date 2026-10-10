import path from "node:path";
import { defineConfig } from "vitest/config";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";

// Story render smoke test: mounts every story from .storybook/main.ts in
// headless Chromium and fails on render errors and `play()` assertions.
// Stories can compile and build fine yet throw on mount (e.g. a nested
// <Router> — #706, #707), which nothing else in CI catches.
//
// Kept separate from vitest.config.ts because the unit tests run in jsdom
// while this needs Vitest browser mode. Run with `npm run test:storybook`.
export default defineConfig({
  plugins: [storybookTest({ configDir: path.join(import.meta.dirname, ".storybook") })],
  test: {
    name: "storybook",
    root: import.meta.dirname,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
