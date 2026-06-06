import { defineConfig } from "vite";

// Storybook runs against an isolated Vite config, not the app's
// frontend/vite.config.ts. The app config pulls in vite-plugin-pwa (which
// fails Storybook's build on its >2 MiB manager bundle) and a second React
// plugin. main.ts re-declares the few aliases Storybook actually needs.
//
// Without this, Storybook's builder auto-discovers frontend/vite.config.ts
// because it resolves the project root as the config dir's parent (frontend/).
export default defineConfig({});
