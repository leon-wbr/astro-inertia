import { defineConfig } from "vitest/config";

// Used only by `pnpm test:mutation`. The handler's real-timer 504 test hangs
// inside Stryker's runner, and it exercises handler.ts, which is not mutated.
export default defineConfig({
  test: {
    testNamePattern: "^(?!.*answers 504)",
  },
});
