import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import path from "path";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "src"),
  publicDir: path.resolve(__dirname, "src/public"),
  resolve: {
    alias: {
      "@lexicons": path.resolve(__dirname, "../../lexicons"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../../dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "../../lexicons"), "."],
    },
    proxy: {
      "/api": "http://localhost:3000",
      "/oauth": "http://localhost:3000",
      "/media": "http://localhost:3000",
    },
  },
});
