// Playwright E2E (M5): the closed loop against a dedicated e2e database —
// sign in (magic link read from the dev-server log), compose a draft,
// schedule it, shorten a link, click it twice, and see the graph move.
import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1, // one server, one workspace — serial
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "DATABASE_URL=postgresql://spellpaw:spellpaw@localhost:5433/spellpaw_e2e AUTH_URL=http://localhost:" +
      `${PORT} PORT=${PORT} sh -c 'npx prisma migrate deploy && pnpm db:seed && (pnpm dev > /tmp/spellpaw-e2e.log 2>&1)'`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
