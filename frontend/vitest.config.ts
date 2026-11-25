import { defineConfig } from "vitest/config";

// Unit tests live next to the code they cover as `*.test.ts` /
// `*.test.tsx` under `src/`. The Playwright e2e/integration suites in
// `frontend/tests/` use `*.spec.ts` and are not run by vitest.
//
// `root` is set to this file's directory so `include` resolves
// relative to `frontend/` regardless of where vitest was launched from.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Tests that render React components or call hooks via
    // `renderHook` need a DOM. Pure-logic tests don't care.
    environment: "jsdom",
    // jsdom's Storage is gated on having a real origin; the default
    // "about:blank" leaves window.localStorage undefined.
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    setupFiles: ["./vitest.setup.ts"],
  },
});
