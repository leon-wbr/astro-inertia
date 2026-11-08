import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
      reporter: ["text", "html", "json-summary"],
      // Just below the measured 78.78 / 79.87 / 76.78 / 79.79 (unit tests only;
      // index.ts, runtime.ts and client.ts are covered by e2e).
      thresholds: { statements: 78, branches: 79, functions: 76, lines: 79 },
    },
  },
});
