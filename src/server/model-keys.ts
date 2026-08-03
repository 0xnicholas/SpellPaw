// Model provider key service (BYOK — ADR-0005). Keys are AES-256-GCM
// encrypted at rest; the API never returns plaintext.
import type { PrismaClient } from "@/generated/prisma/client";
import { decryptString, encryptString } from "@/lib/crypto";
import { AI_PROVIDERS, keyPreview, type AiProvider } from "@/lib/ai/providers";
import { ApiError } from "./errors";

export interface ModelKeyView {
  id: string;
  provider: AiProvider;
  keyPreview: string;
  isActive: boolean;
  lastChecked: Date | null;
  createdAt: Date;
}

export function assertProvider(provider: string): AiProvider {
  if (!AI_PROVIDERS.includes(provider as AiProvider)) {
    throw new ApiError(400, `unknown provider "${provider}" — expected ${AI_PROVIDERS.join(" or ")}`);
  }
  return provider as AiProvider;
}

export async function listModelKeys(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<ModelKeyView[]> {
  const keys = await prisma.modelProviderKey.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });
  return keys.map((k) => ({
    id: k.id,
    provider: k.provider as AiProvider,
    keyPreview: k.keyPreview,
    isActive: k.isActive,
    lastChecked: k.lastChecked,
    createdAt: k.createdAt,
  }));
}

export async function saveModelKey(
  prisma: PrismaClient,
  workspaceId: string,
  provider: string,
  apiKey: string,
  encryptionKey: Buffer,
): Promise<ModelKeyView> {
  const normalized = assertProvider(provider);
  const trimmed = apiKey.trim();
  if (trimmed.length < 10) {
    throw new ApiError(400, "API key looks too short to be valid");
  }
  const key = await prisma.modelProviderKey.create({
    data: {
      workspaceId,
      provider: normalized,
      encryptedKey: encryptString(trimmed, encryptionKey),
      keyPreview: keyPreview(trimmed),
    },
  });
  return {
    id: key.id,
    provider: key.provider as AiProvider,
    keyPreview: key.keyPreview,
    isActive: key.isActive,
    lastChecked: key.lastChecked,
    createdAt: key.createdAt,
  };
}

export async function deleteModelKey(
  prisma: PrismaClient,
  workspaceId: string,
  keyId: string,
): Promise<void> {
  const key = await prisma.modelProviderKey.findFirst({ where: { id: keyId, workspaceId } });
  if (!key) throw new ApiError(404, "model key not found");
  await prisma.modelProviderKey.delete({ where: { id: key.id } });
}

/**
 * Decrypt an active key by provider. Returns null when the workspace has no
 * active key for that provider. Callers may pass an ordered provider list to
 * try several keys (e.g. ["openai", "anthropic"]).
 */
export async function getActiveModelKey(
  prisma: PrismaClient,
  workspaceId: string,
  encryptionKey: Buffer,
  providers: AiProvider[] = ["openai", "anthropic"],
): Promise<{ provider: AiProvider; apiKey: string; keyId: string } | null> {
  const keys = await prisma.modelProviderKey.findMany({
    where: { workspaceId, isActive: true, provider: { in: providers } },
    // Newest first — a replaced key wins over a stale one.
    orderBy: { createdAt: "desc" },
  });
  for (const candidate of providers) {
    const key = keys.find((k) => k.provider === candidate);
    if (!key) continue;
    return {
      provider: candidate,
      apiKey: decryptString(key.encryptedKey, encryptionKey),
      keyId: key.id,
    };
  }
  return null;
}

/** Persist the result of a key check (spec §8 degradation: banner + greyed button). */
export async function touchModelKeyCheck(
  prisma: PrismaClient,
  keyId: string,
  ok: boolean,
): Promise<void> {
  await prisma.modelProviderKey.update({
    where: { id: keyId },
    data: { isActive: ok, lastChecked: new Date() },
  });
}
