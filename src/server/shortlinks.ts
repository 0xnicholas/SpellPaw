// Short link domain service (ADR-0009 — self-hosted, click attribution is the
// primary Content Touch signal). Deviations from the spec sketch, documented:
// links are workspace-scoped and unique per channel variant (per-channel
// attribution), and the redirect endpoint is a Hono route (/s/:code) rather
// than Next.js Middleware — middleware runs on the edge runtime where BullMQ
// (node) cannot enqueue reliably; the route keeps the same Redis-cached 301
// semantics and well under 30ms on cache hits.
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

export const SHORT_CODE_LENGTH = 6;

export interface ShortLinkRecord {
  id: string;
  code: string;
  targetUrl: string;
  workspaceId: string;
  postId: string;
  variantId: string;
}

export function generateShortCode(): string {
  return randomBytes(6).toString("base64url").slice(0, SHORT_CODE_LENGTH);
}

/** One link per variant (unique constraint) — idempotent. */
export async function createShortLink(
  prisma: PrismaClient,
  workspaceId: string,
  postId: string,
  variantId: string,
  targetUrl: string,
): Promise<ShortLinkRecord> {
  const existing = await prisma.shortLink.findUnique({ where: { variantId } });
  if (existing) {
    return {
      id: existing.id,
      code: existing.code,
      targetUrl: existing.targetUrl,
      workspaceId: existing.workspaceId,
      postId: existing.postId,
      variantId: existing.variantId,
    };
  }
  // Collision-retry: the code column is unique; 36-bit space makes collisions
  // vanishingly rare, but a retry loop keeps this total.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateShortCode();
    try {
      const link = await prisma.shortLink.create({
        data: { workspaceId, postId, variantId, code, targetUrl },
      });
      return {
        id: link.id,
        code: link.code,
        targetUrl: link.targetUrl,
        workspaceId: link.workspaceId,
        postId: link.postId,
        variantId: link.variantId,
      };
    } catch (err) {
      const isCollision =
        typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
      if (!isCollision) throw err;
    }
  }
  throw new Error("short code space exhausted");
}

export function shortLinkUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/$/, "")}/s/${code}`;
}

export interface ShortLinkCache {
  get: (k: string) => Promise<string | null>;
  set: (k: string, v: string, ttlSec: number) => Promise<unknown>;
}

/** Resolve via Redis cache (TTL 24h), falling through to PostgreSQL. */
export async function resolveShortLink(
  prisma: PrismaClient,
  code: string,
  redis: ShortLinkCache | null,
): Promise<ShortLinkRecord | null> {
  const CACHE_TTL = 24 * 60 * 60;
  const key = `sp:sl:${code}`;
  if (redis) {
    const cached = await redis.get(key);
    if (cached) {
      try {
        return JSON.parse(cached) as ShortLinkRecord;
      } catch {
        // corrupted cache entry — fall through to the DB
      }
    }
  }
  const link = await prisma.shortLink.findUnique({ where: { code } });
  if (!link) return null;
  const record: ShortLinkRecord = {
    id: link.id,
    code: link.code,
    targetUrl: link.targetUrl,
    workspaceId: link.workspaceId,
    postId: link.postId,
    variantId: link.variantId,
  };
  if (redis) await redis.set(key, JSON.stringify(record), CACHE_TTL).catch(() => {});
  return record;
}
