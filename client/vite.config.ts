import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// NOTE: no dev proxy here. We chose CORS on the FastAPI side (build-plan Phase 3.5),
// so the app calls the API's full origin (http://localhost:8000/api) directly — see
// the baseUrl in src/api.ts. If you had instead chosen a proxy, you'd add a
// `server.proxy` block here and use relative "/api" URLs.
//
// Tailwind v4 is a Vite PLUGIN (no tailwind.config.js, no PostCSS config needed). The
// plugin scans your source for class names and generates the CSS; you activate it with
// a single `@import "tailwindcss";` in src/index.css.
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: { port: 5173 },
});
