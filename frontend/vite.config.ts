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
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: path.resolve(__dirname, "../dist/public"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return;
          if (id.includes("maplibre-gl")) return "maplibre";
          if (id.includes("/@mui/") || id.includes("/@emotion/")) return "mui";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router") ||
            id.includes("/scheduler/")
          )
            return "react";
          if (id.includes("/@reduxjs/") || id.includes("/react-redux/")) return "redux";
          if (id.includes("/exifreader/")) return "exif";
        },
      },
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "../lexicons"), "."],
    },
    hmr: {
      // When accessed via the Rust proxy on port 3000, HMR WebSocket must still
      // connect directly to Vite so it isn't routed through the proxy
      host: 'localhost',
      clientPort: 5173,
    },
    proxy: {
      "/api": "http://localhost:3000",
      "/oauth": "http://localhost:3000",
      "/media": "http://localhost:3000",
    },
  },
});
