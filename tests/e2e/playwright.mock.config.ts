import { defineConfig, devices } from "@playwright/test";

// Overridable so parallel worktrees don't collide on the same ports.
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 4610);
const ASTRO_PORT = Number(process.env.ASTRO_PORT ?? 4611);

export default defineConfig({
  testDir: "mock",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${ASTRO_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `node ../mock-server/server.ts ${MOCK_PORT}`,
      url: `http://127.0.0.1:${MOCK_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      // The production build of examples/basic (pnpm build runs first in verify).
      command: "node ../../examples/basic/dist/server/entry.mjs",
      url: `http://127.0.0.1:${ASTRO_PORT}/hello`,
      reuseExistingServer: false,
      env: {
        HOST: "127.0.0.1",
        PORT: String(ASTRO_PORT),
        INERTIA_BACKEND: `http://127.0.0.1:${MOCK_PORT}`,
      },
    },
  ],
});
