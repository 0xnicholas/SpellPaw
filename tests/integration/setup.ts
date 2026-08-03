// Integration test bootstrap — resets the TEST database schema once per run.
// Unit tests never touch the DB; only this directory does.
import { execSync } from "node:child_process";
import "dotenv/config";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL (or DATABASE_URL) must be set for integration tests");
}

export function resetTestSchema(): void {
  execSync(
    "pnpm exec prisma db push --force-reset --accept-data-loss --url " +
      JSON.stringify(TEST_DATABASE_URL),
    { stdio: "pipe" },
  );
  // `db push` does not manage views — re-apply the contact_timeline VIEW
  // (same SQL ships inside the m4 migration for prod). Prisma 7's `db execute`
  // reads the datasource URL from prisma.config.ts (process.env.DATABASE_URL),
  // so override it to the test URL for this call.
  execSync(
    "pnpm exec prisma db execute --file prisma/views/contact_timeline.sql",
    {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    },
  );
}
