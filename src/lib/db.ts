// Prisma 7 client — driver-adapter style.
// A singleton for the app process; a factory for tests (separate TEST_DATABASE_URL).
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export function createPrismaClient(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

export const prisma: PrismaClient = createPrismaClient(url);
