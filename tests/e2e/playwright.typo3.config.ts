import { defineConfig, devices } from "@playwright/test";

// The TYPO3 DDEV example (scripts/typo3.sh up) must be running.
const BACKEND = process.env.INERTIA_BACKEND ?? "http://astro-inertia-typo3.ddev.site";
const ASTRO_PORT = 4621;

export default defineConfig({
  testDir: "typo3",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${ASTRO_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node ../../examples/typo3/dist/server/entry.mjs",
    url: `http://127.0.0.1:${ASTRO_PORT}/`,
    reuseExistingServer: false,
    env: { HOST: "127.0.0.1", PORT: String(ASTRO_PORT), INERTIA_BACKEND: BACKEND },
  },
});
