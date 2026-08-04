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
import { planUsage } from "../limits";

const modelKeySchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().min(1),
});

const apiTokenSchema = z.object({
  name: z.string().min(1).max(60),
});

// spec §2 — workspace settings surface (M5). name is the display name;
// mcpPublishApproval is the MCP publish trust toggle (spec §3);
// mcpInboxAccess is the MCP inbox PII-exception gate (M6, ADR-0014).
const workspacePatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  mcpPublishApproval: z.boolean().optional(),
  mcpInboxAccess: z.boolean().optional(),
});

export function settingsRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // --- Workspace settings (spec §2; M5) ---

  app.get("/workspace", async (c) => {
    const workspaceId = c.get("workspaceId");
    const workspace = await deps.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { id: true, name: true, mcpPublishApproval: true, mcpInboxAccess: true },
    });
    const usage = await planUsage(deps.prisma, workspaceId);
    return c.json({
      workspace,
      limits: {
        maxChannels: usage.maxChannels,
        maxPosts: usage.maxPosts,
        maxContacts: usage.maxContacts,
        usedChannels: usage.usedChannels,
        usedPosts: usage.usedPosts,
        usedContacts: usage.usedContacts,
      },
    });
  });

  app.patch("/workspace", async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = await readJson(c, workspacePatchSchema);
    const data: Record<string, string | boolean> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.mcpPublishApproval !== undefined) data.mcpPublishApproval = body.mcpPublishApproval;
    if (body.mcpInboxAccess !== undefined) data.mcpInboxAccess = body.mcpInboxAccess;
    const workspace = await deps.prisma.workspace.update({
      where: { id: workspaceId },
      data,
      select: { id: true, name: true, mcpPublishApproval: true, mcpInboxAccess: true },
    });
    return c.json({ workspace });
  });

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
