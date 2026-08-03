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
}
