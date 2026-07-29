import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages serves this project below /navi/. Locally, Vite keeps the app
// at the root so the same PWA can be tested without special URLs.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/navi/" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
