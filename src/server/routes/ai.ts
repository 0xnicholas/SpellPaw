// /api/ai routes — Composer AI rewrite (BYOK; spec §6 rate limit 10/min).
import { Hono } from "hono";
import { z } from "zod";
import { AiProviderError, generateContent } from "@/lib/ai/providers";
import { ApiError } from "../errors";
import { getActiveModelKey, touchModelKeyCheck } from "../model-keys";
import { readJson, type AppEnv, type RouteDeps } from "./shared";

const generateSchema = z.object({
  text: z.string().min(1).max(5000),
  channelSlug: z.string().optional(),
});

export function aiRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/generate", async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = await readJson(c, generateSchema);

    const limited = await deps.rateLimiter?.allow(`sp:rl:ai:${workspaceId}`, 10, 60);
    if (limited === false) {
      throw new ApiError(429, "RATE_LIMITED");
    }

    const active = await getActiveModelKey(deps.prisma, workspaceId, deps.encryptionKey);
    if (!active) {
      throw new ApiError(400, "MODEL_KEY_MISSING");
    }

    const generate = deps.aiGenerate ?? generateContent;
    try {
      const content = await generate({
        provider: active.provider,
        apiKey: active.apiKey,
        text: body.text,
        channelSlug: body.channelSlug,
      });
      return c.json({ content });
    } catch (err) {
      if (err instanceof AiProviderError) {
        // ADR-0005 graceful degradation: an invalid key is deactivated so the
        // next call falls through to another key (or MODEL_KEY_MISSING).
        if (err.code === "MODEL_KEY_INVALID") {
          await touchModelKeyCheck(deps.prisma, active.keyId, false);
        }
        const status = err.code === "MODEL_KEY_QUOTA" ? 429 : err.code === "MODEL_KEY_INVALID" ? 400 : 502;
        throw new ApiError(status, err.code);
      }
      throw err;
    }
  });

  return app;
}
