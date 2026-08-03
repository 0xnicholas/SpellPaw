// Embedded Hono API (ADR-0010 style: same process, /api/* catch-all route).
// Route modules live in src/server/routes/*; this file owns auth, workspace
// scoping, and the error handler. Auth is injected via getAccountId so the app
// is unit/integration-testable.
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ChannelAdapter } from "@/adapters/channels/types";
import { getAdapter } from "@/adapters/channels/registry";
import { getEncryptionKey } from "@/lib/crypto";
import type { RateLimiter } from "@/lib/rate-limit";
import type { GenerateOptions } from "@/lib/ai/providers";
import { ApiError } from "./errors";
import { ensureWorkspace } from "./workspaces";
import type { Publisher } from "./publisher";
import { resolveApiToken } from "./api-tokens";
import type { AppEnv, RouteDeps } from "./routes/shared";
import { postsRoutes } from "./routes/posts";
import { variantsRoutes } from "./routes/variants";
import { scheduleRoutes } from "./routes/schedule";
import { calendarRoutes } from "./routes/calendar";
import { channelsRoutes } from "./routes/channels";
import { settingsRoutes } from "./routes/settings";
import { aiRoutes } from "./routes/ai";
import { contactsRoutes } from "./routes/contacts";
import { mcpRoutes } from "./routes/mcp";

export interface ApiDeps {
  prisma: PrismaClient;
  /** Queue/worker abstraction (BullMQ in prod, sync fake in tests). */
  publisher: Publisher;
  /** Injected adapter map (tests); defaults to the env-driven registry. */
  adapters?: Record<string, ChannelAdapter>;
  /** Resolves the authenticated account id from the request (NextAuth JWT). */
  getAccountId: (c: Context) => Promise<string | null>;
  encryptionKey?: Buffer;
  /** Redis-backed rate limiter; omitted → no rate limiting (dev/tests). */
  rateLimiter?: RateLimiter;
  /** Injectable for tests; defaults to the real BYOK provider call. */
  aiGenerate?: (opts: GenerateOptions) => Promise<string>;
}

export function createApiApp(deps: ApiDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const routeDeps: RouteDeps = {
    prisma: deps.prisma,
    publisher: deps.publisher,
    adapters: deps.adapters ?? {
      twitter: getAdapter("twitter"),
      linkedin: getAdapter("linkedin"),
      instagram: getAdapter("instagram"),
    },
    encryptionKey: deps.encryptionKey ?? getEncryptionKey(),
    rateLimiter: deps.rateLimiter,
    aiGenerate: deps.aiGenerate,
  };

  // MCP bearer auth: workspace tokens bypass the session flow. The MCP handler
  // still runs — this middleware only annotates the context. Bearer-first:
  // an invalid bearer 401s even if a valid session cookie exists (simpler and
  // safer than merging two identities).
  app.use("/api/mcp", async (c, next) => {
    const bearer = c.req.header("authorization");
    if (bearer?.startsWith("Bearer ")) {
      const resolved = await resolveApiToken(deps.prisma, bearer.slice(7).trim());
      if (!resolved) {
        return c.json({ error: "unauthorized" }, 401);
      }
      c.set("accountId", `token:${resolved.workspaceId}`);
      c.set("workspaceId", resolved.workspaceId);
      c.set("mcpViaToken", true);
    }
    await next();
  });

  app.use("*", async (c, next) => {
    if (!c.get("mcpViaToken")) {
      const accountId = await deps.getAccountId(c);
      if (!accountId) {
        return c.json({ error: "unauthorized" }, 401);
      }
      c.set("accountId", accountId);
    }
    await next();
  });

  // Workspace scoping: explicit x-workspace-id header wins; otherwise the
  // account's default workspace is used (bootstrap on first login).
  // MCP bearer requests already carry their workspace (from the token).
  app.use("*", async (c, next) => {
    if (c.get("mcpViaToken")) return next();
    const accountId = c.get("accountId");
    const requested = c.req.header("x-workspace-id");
    if (requested) {
      const workspace = await deps.prisma.workspace.findFirst({
        where: { id: requested, accountId },
      });
      if (!workspace) {
        return c.json({ error: "workspace not found" }, 404);
      }
      c.set("workspaceId", workspace.id);
    } else {
      const workspace = await ensureWorkspace(deps.prisma, accountId);
      c.set("workspaceId", workspace.id);
    }
    await next();
  });

  // --- Route modules (spec §2) ---
  app.route("/api/posts", postsRoutes(routeDeps));
  app.route("/api/variants", variantsRoutes(routeDeps));
  app.route("/api/schedule", scheduleRoutes(routeDeps));
  app.route("/api/calendar", calendarRoutes(routeDeps));
  app.route("/api/channels", channelsRoutes(routeDeps));
  app.route("/api/settings", settingsRoutes(routeDeps));
  app.route("/api/ai", aiRoutes(routeDeps));
  app.route("/api/contacts", contactsRoutes(routeDeps));
  app.route("/api/mcp", mcpRoutes(routeDeps));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error("[api] unhandled error", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
