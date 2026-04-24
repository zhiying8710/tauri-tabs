import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const exampleRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: exampleRoot,
  clearScreen: false,
  server: {
    strictPort: true,
    port: 1420
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022"
  }
});
