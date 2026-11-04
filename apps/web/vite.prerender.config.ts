import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds src/prerender/entry-server.tsx for Node into dist-prerender, so prerender.ts can render
// the public pages to HTML after vite build. Everything is bundled (noExternal), so the font and
// style imports in the screens are dropped by Vite instead of reaching Node.
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  build: {
    ssr: "src/prerender/entry-server.tsx",
    outDir: "dist-prerender",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { output: { entryFileNames: "entry-server.js" } },
  },
  ssr: { noExternal: true },
});
