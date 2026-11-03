// Builds the browser app into apps/web/dist for the api to serve at /.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// React, ES module workers so ingest's extraction worker builds, and dist as the output folder.
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
