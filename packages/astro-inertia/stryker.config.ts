import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

// Stryker only auto-discovers .json/.js/.mjs/.cjs configs, so test:mutation
// names this file; Node loads it through its built-in type stripping.
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: ["src/forward.ts", "src/protocol.ts"],
  reporters: ["clear-text", "html", "json"],
  coverageAnalysis: "perTest",
  vitest: { configFile: "stryker.vitest.config.ts" },
  concurrency: 4,
  tempDirName: ".stryker-tmp",
} satisfies PartialStrykerOptions;
