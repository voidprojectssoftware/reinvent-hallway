// The web app builds to apps/web/dist, which the API Worker serves as static
// assets with the SPA fallback (apps/api/wrangler.jsonc). No Vite dev server
// is in the loop: `npm run dev` rebuilds here on change and wrangler serves
// the result, so /api and the app share one origin and the deep-link rules
// are the Worker's own (ADR 0010).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // `npm run dev` overrides this for its watcher (--no-emptyOutDir), since
  // wrangler serves this directory while it rebuilds (apps/api/scripts/dev.mjs).
  build: { outDir: "dist", emptyOutDir: true },
});
