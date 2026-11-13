import { defineConfig } from "vitest/config";

// Locally, at most 4 workers: D1 tests each start a workerd process, and
// several agents verify on this machine at once (void-crm hit the OOM killer
// with one worker per core). CI has its own runner and keeps the default.
export default defineConfig({
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    ...(process.env.CI ? {} : { maxWorkers: 4 }),
  },
});
