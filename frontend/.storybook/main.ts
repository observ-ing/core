import path from "path";
import { fileURLToPath } from "url";
import type { StorybookConfig } from "@storybook/react-vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-themes"],
  staticDirs: ["./public"],
  framework: {
    name: "@storybook/react-vite",
    options: {
      // Use the isolated Storybook Vite config rather than letting the builder
      // auto-discover the app's frontend/vite.config.ts (see vite.config.ts).
      builder: {
        viteConfigPath: path.resolve(__dirname, "vite.config.ts"),
      },
    },
  },
  viteFinal: async (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@lexicons": path.resolve(__dirname, "../../lexicons"),
      // The vite-plugin-pwa virtual module isn't generated in Storybook's
      // Vite config; alias to a stub so components that import it (e.g.
      // UpdatePrompt) can still mount.
      "virtual:pwa-register/react": path.resolve(__dirname, "pwa-register-stub.ts"),
    };
    return config;
  },
};

export default config;
