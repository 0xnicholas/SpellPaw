// Shared helpers + types for the route modules (src/server/routes/*).
import type { Context } from "hono";
import type { ZodType } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ChannelAdapter } from "@/adapters/channels/types";
import type { GenerateOptions } from "@/lib/ai/providers";
import type { RateLimiter } from "@/lib/rate-limit";
import { ApiError } from "../errors";
import type { Publisher } from "../publisher";

export type AppEnv = {
  Variables: {
    accountId: string;
    workspaceId: string;
    /** Set when the request authenticated via a workspace bearer token (MCP). */
    mcpViaToken?: boolean;
  };
};

export interface RouteDeps {
  prisma: PrismaClient;
  publisher: Publisher;
  adapters: Record<string, ChannelAdapter>;
  encryptionKey: Buffer;
  rateLimiter?: RateLimiter;
  /** Injectable for tests; defaults to the real BYOK provider call. */
  aiGenerate?: (opts: GenerateOptions) => Promise<string>;
}

export async function readJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "invalid JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return parsed.data;
}

export function parseDateParam(value: string | undefined, label: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `${label} must be a valid ISO date`);
  }
  return date;
}

export function clampDays(days: number): number {
  if (Number.isNaN(days)) return 7;
  return Math.min(31, Math.max(1, Math.floor(days)));
}

/** Live queue state per variant (null when terminal/none) — for the UI. */
export async function enrichQueueStates(
  deps: RouteDeps,
  posts: Array<{ variants: Array<{ id: string }> }>,
) {
  await Promise.all(
    posts.flatMap((post) =>
      post.variants.map(async (variant) => {
        (variant as { queueState?: unknown }).queueState =
          await deps.publisher.getVariantQueueState(variant.id);
      }),
    ),
  );
}
