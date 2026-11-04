// Builds the browser app into apps/web/dist for the api to serve at /.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// React, ES module workers so ingest's extraction worker builds, and dist as the output folder.
// No asset is written into the CSS as a data: address (assetsInlineLimit 0): the site's policy
// allows fonts from its own origin only, so an inlined font subset would be refused by the browser.
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
});
