// /api/settings routes — BYOK model keys + workspace API tokens.
import { Hono } from "hono";
import { z } from "zod";
import {
  deleteModelKey,
  listModelKeys,
  saveModelKey,
} from "../model-keys";
import {
  listApiTokens,
  mintApiToken,
  revokeApiToken,
} from "../api-tokens";
import { readJson, type AppEnv, type RouteDeps } from "./shared";

const modelKeySchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().min(1),
});

const apiTokenSchema = z.object({
  name: z.string().min(1).max(60),
});

export function settingsRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // --- Model keys (BYOK, ADR-0005) ---
  app.get("/model-keys", async (c) => {
    const keys = await listModelKeys(deps.prisma, c.get("workspaceId"));
    return c.json({ keys });
  });

  app.post("/model-keys", async (c) => {
    const body = await readJson(c, modelKeySchema);
    const key = await saveModelKey(
      deps.prisma,
      c.get("workspaceId"),
      body.provider,
      body.apiKey,
      deps.encryptionKey,
    );
    return c.json({ key }, 201);
  });

  app.delete("/model-keys/:id", async (c) => {
    await deleteModelKey(deps.prisma, c.get("workspaceId"), c.req.param("id"));
    return c.json({ deleted: true });
  });

  // --- API tokens (bearer auth for external MCP/AI clients) ---
  app.get("/api-tokens", async (c) => {
    const tokens = await listApiTokens(deps.prisma, c.get("workspaceId"));
    return c.json({ tokens });
  });

  app.post("/api-tokens", async (c) => {
    const body = await readJson(c, apiTokenSchema);
    const { token, view } = await mintApiToken(deps.prisma, c.get("workspaceId"), body.name);
    // `token` is the only time the plaintext is ever returned.
    return c.json({ token, tokenView: view }, 201);
  });

  app.delete("/api-tokens/:id", async (c) => {
    await revokeApiToken(deps.prisma, c.get("workspaceId"), c.req.param("id"));
    return c.json({ deleted: true });
  });

  return app;
}
