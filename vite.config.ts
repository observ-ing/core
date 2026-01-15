import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyDir: true,
  },
});
