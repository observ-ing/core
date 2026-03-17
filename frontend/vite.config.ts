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
      "@lexicons": path.resolve(__dirname, "../lexicons"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-mui": ["@mui/material", "@mui/icons-material"],
          "vendor-map": ["maplibre-gl"],
          "vendor-redux": ["@reduxjs/toolkit", "react-redux"],
        },
      },
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "../lexicons"), "."],
    },
    proxy: {
      "/api": "http://localhost:3000",
      "/oauth": "http://localhost:3000",
      "/media": "http://localhost:3000",
    },
  },
});
