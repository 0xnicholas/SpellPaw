import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    setupFiles: ["./tests/vitest-setup.ts"],
    // Each integration file resets the TEST database in beforeAll via
    // `prisma db push --force-reset` (~7s with pnpm exec overhead) — the
    // default 10s hook timeout is too tight under CPU contention.
    hookTimeout: 60_000,
    // Integration files reset the TEST database schema in beforeAll — run test
    // files serially so two resets can't race each other.
    fileParallelism: false,
    // Unit tests in src/ run without a database; tests/integration/* resets the
    // TEST database schema in its own beforeAll.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
