// Builds the screen gallery (gallery.html) into apps/web/dist-gallery, a page that shows every screen and state from test data.
// It is a development tool: the production build (vite.config.ts) never includes it.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative asset paths, so the built gallery opens straight from disk in a headless browser.
export default defineConfig({
  plugins: [react()],
  base: "./",
  worker: { format: "es" },
  build: {
    outDir: "dist-gallery",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: "gallery.html" },
  },
});
