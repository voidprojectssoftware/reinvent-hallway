import { defineConfig } from "vitest/config";

// `npm run test:e2e`: one Worker for the whole run (hallway-worker.ts), and
// the files run one after another against it.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["**/*.e2e.test.ts"],
    globalSetup: ["./hallway-worker.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
