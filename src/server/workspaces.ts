// Workspace bootstrap — every account gets one default workspace on first login.
import type { PrismaClient } from "@/generated/prisma/client";

export async function ensureWorkspace(
  prisma: PrismaClient,
  accountId: string,
  name = "My Workspace",
) {
  const existing = await prisma.workspace.findFirst({ where: { accountId } });
  if (existing) return existing;
  return prisma.workspace.create({ data: { accountId, name } });
}
