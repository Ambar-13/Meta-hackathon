// Builds the browser app into apps/web/dist for the api to serve at / (IMPLEMENTATION.md section 1).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// React, ES module workers so ingest's extraction worker builds (seams S4), and dist as the output folder (seams S8).
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
