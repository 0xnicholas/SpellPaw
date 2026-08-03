// Workspace-scoped bearer tokens for external MCP/AI clients (Claude Desktop,
// Cursor, custom agents). Only a SHA-256 hash is stored; the plaintext token is
// shown once at mint time and cannot be recovered afterwards.
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { ApiError } from "./errors";

const TOKEN_PREFIX = "sp_";
const TOKEN_BYTES = 24; // ~43 base58 chars of entropy

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function generateToken(): string {
  const bytes = randomBytes(TOKEN_BYTES);
  let token = "";
  for (const b of bytes) {
    token += BASE58[b % BASE58.length];
  }
  return TOKEN_PREFIX + token;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface ApiTokenView {
  id: string;
  name: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export async function mintApiToken(
  prisma: PrismaClient,
  workspaceId: string,
  name: string,
): Promise<{ token: string; view: ApiTokenView }> {
  const trimmed = name.trim();
  if (!trimmed) throw new ApiError(400, "token name is required");
  const token = generateToken();
  const row = await prisma.apiToken.create({
    data: { workspaceId, name: trimmed.slice(0, 60), tokenHash: hashToken(token) },
  });
  return {
    token, // shown exactly once
    view: { id: row.id, name: row.name, lastUsedAt: null, revokedAt: null, createdAt: row.createdAt },
  };
}

export async function listApiTokens(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<ApiTokenView[]> {
  const rows = await prisma.apiToken.findMany({
    where: { workspaceId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lastUsedAt: r.lastUsedAt,
    revokedAt: null,
    createdAt: r.createdAt,
  }));
}

export async function revokeApiToken(
  prisma: PrismaClient,
  workspaceId: string,
  tokenId: string,
): Promise<void> {
  const row = await prisma.apiToken.findFirst({ where: { id: tokenId, workspaceId, revokedAt: null } });
  if (!row) throw new ApiError(404, "api token not found");
  await prisma.apiToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
}

/**
 * Verify a bearer token and resolve its workspace. Returns null when the token
 * is unknown or revoked. Touches lastUsedAt (best-effort).
 */
export async function resolveApiToken(
  prisma: PrismaClient,
  token: string,
): Promise<{ workspaceId: string; tokenId: string } | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.revokedAt) return null;
  void prisma.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { workspaceId: row.workspaceId, tokenId: row.id };
}
