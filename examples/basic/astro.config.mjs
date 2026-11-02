import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import inertia from "astro-inertia";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // Astro.url (and so X-Forwarded-Host) only trusts the Host header for these.
  security: { allowedDomains: [{ hostname: "localhost" }, { hostname: "127.0.0.1" }] },
  integrations: [
    react(),
    inertia({
      // The backend comes from INERTIA_BACKEND at runtime (see .env.example).
      version: "1",
      runtime: "./src/inertia.runtime.ts",
      types: { schema: "./inertia.schema.json" },
    }),
  ],
});
