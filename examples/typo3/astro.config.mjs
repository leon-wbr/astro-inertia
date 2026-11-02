import node from "@astrojs/node";
import { defineConfig } from "astro/config";
import inertia from "astro-inertia";

// TYPO3 keeps routing, languages, redirects and access; Astro renders the
// page objects of the inertia-typo3 adapter. The backend URL comes from
// INERTIA_BACKEND at runtime, e.g. https://inertia-typo3.ddev.site
// (`pnpm typo3:up` starts it).
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  security: { allowedDomains: [{ hostname: "localhost" }, { hostname: "127.0.0.1" }] },
  integrations: [inertia()],
});
