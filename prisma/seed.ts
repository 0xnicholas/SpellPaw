// Seed the canonical Channel catalog. New platforms are added here (INSERT), never via migration.
// Run: pnpm db:seed
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const CHANNELS = [
  { slug: "twitter", name: "Twitter / X" },
  { slug: "linkedin", name: "LinkedIn" },
  { slug: "instagram", name: "Instagram" },
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  for (const channel of CHANNELS) {
    await prisma.channel.upsert({
      where: { slug: channel.slug },
      update: { name: channel.name },
      create: channel,
    });
  }

  console.log(`Seeded ${CHANNELS.length} channels: ${CHANNELS.map((c) => c.slug).join(", ")}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
