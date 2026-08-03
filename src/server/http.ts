// Embedded Hono API (ADR-0010 style: same process, /api/* catch-all route).
// Auth is injected via getAccountId so the app is unit/integration-testable.
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z, type ZodType } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ChannelAdapter } from "@/adapters/channels/types";
import { getAdapter } from "@/adapters/channels/registry";
import { getEncryptionKey } from "@/lib/crypto";
import { ApiError } from "./errors";
import { ensureWorkspace } from "./workspaces";
import { DAY_MS, startOfDayUtc } from "@/lib/time";
import {
  cancelSchedule,
  createPost,
  getCalendarEvents,
  listPosts,
  publishPost,
  schedulePost,
  updateVariant,
} from "./posts";
import {
  completeConnect,
  disconnectChannel,
  listChannelsWithStatus,
  startConnect,
  workspaceIdFromState,
} from "./channels";

type Env = {
  Variables: {
    accountId: string;
    workspaceId: string;
  };
};

export interface ApiDeps {
  prisma: PrismaClient;
  /** Injected adapter map (tests); defaults to the env-driven registry. */
  adapters?: Record<string, ChannelAdapter>;
  /** Resolves the authenticated account id from the request (NextAuth JWT). */
  getAccountId: (c: Context) => Promise<string | null>;
  encryptionKey?: Buffer;
}

const postCreateSchema = z.object({
  title: z.string().trim().max(200).optional().nullable(),
  variants: z
    .array(z.object({ channelSlug: z.string().min(1), content: z.string() }))
    .min(1),
});

const variantUpdateSchema = z.object({ content: z.string() });

const scheduleSchema = z.object({ scheduledAt: z.string().min(1) });

async function readJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "invalid JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

function parseDateParam(value: string | undefined, label: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `${label} must be a valid ISO date`);
  }
  return date;
}

const oauthStateCookie = (slug: string) => `sp_oauth_state_${slug}`;
const oauthVerifierCookie = (slug: string) => `sp_oauth_verifier_${slug}`;

export function createApiApp(deps: ApiDeps): Hono<Env> {
  const app = new Hono<Env>();
  const adapters = deps.adapters ?? {
    twitter: getAdapter("twitter"),
    linkedin: getAdapter("linkedin"),
    instagram: getAdapter("instagram"),
  };
  const encryptionKey = deps.encryptionKey ?? getEncryptionKey();

  app.use("*", async (c, next) => {
    const accountId = await deps.getAccountId(c);
    if (!accountId) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("accountId", accountId);
    await next();
  });

  // Workspace scoping: explicit x-workspace-id header wins; otherwise the
  // account's default workspace is used (bootstrap on first login).
  app.use("*", async (c, next) => {
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

  // --- Posts ---
  app.get("/api/posts", async (c) => {
    const posts = await listPosts(deps.prisma, c.get("workspaceId"));
    return c.json({ posts });
  });

  app.post("/api/posts", async (c) => {
    const body = await readJson(c, postCreateSchema);
    const post = await createPost(deps.prisma, {
      workspaceId: c.get("workspaceId"),
      title: body.title ?? null,
      variants: body.variants,
    });
    return c.json({ post }, 201);
  });

  app.get("/api/posts/:id", async (c) => {
    const post = await deps.prisma.post.findFirst({
      where: { id: c.req.param("id"), workspaceId: c.get("workspaceId") },
      include: { variants: { include: { channel: true }, orderBy: { id: "asc" as const } } },
    });
    if (!post) throw new ApiError(404, "post not found");
    return c.json({ post });
  });

  app.post("/api/posts/:id/publish", async (c) => {
    const result = await publishPost(
      deps.prisma,
      adapters,
      encryptionKey,
      c.get("workspaceId"),
      c.req.param("id"),
    );
    return c.json(result);
  });

  app.delete("/api/posts/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const post = await deps.prisma.post.findFirst({ where: { id: c.req.param("id"), workspaceId } });
    if (!post) throw new ApiError(404, "post not found");
    await deps.prisma.post.delete({ where: { id: post.id } });
    return c.json({ deleted: true });
  });

  // --- Variants ---
  app.patch("/api/variants/:id", async (c) => {
    const body = await readJson(c, variantUpdateSchema);
    const variant = await updateVariant(deps.prisma, c.get("workspaceId"), c.req.param("id"), body.content);
    return c.json({ variant });
  });

  // --- Schedule ---
  app.post("/api/schedule/:postId", async (c) => {
    const body = await readJson(c, scheduleSchema);
    const scheduledAt = parseDateParam(body.scheduledAt, "scheduledAt");
    if (!scheduledAt) throw new ApiError(400, "scheduledAt is required");
    const post = await schedulePost(deps.prisma, c.get("workspaceId"), c.req.param("postId"), scheduledAt);
    return c.json({ post });
  });

  // Reschedule (spec §2: PATCH /api/schedule/:pid)
  app.patch("/api/schedule/:postId", async (c) => {
    const body = await readJson(c, scheduleSchema);
    const scheduledAt = parseDateParam(body.scheduledAt, "scheduledAt");
    if (!scheduledAt) throw new ApiError(400, "scheduledAt is required");
    const post = await schedulePost(deps.prisma, c.get("workspaceId"), c.req.param("postId"), scheduledAt);
    return c.json({ post });
  });

  app.delete("/api/schedule/:postId", async (c) => {
    const post = await cancelSchedule(deps.prisma, c.get("workspaceId"), c.req.param("postId"));
    return c.json({ post });
  });

  // --- Calendar ---
  app.get("/api/calendar", async (c) => {
    const start = parseDateParam(c.req.query("start"), "start") ?? startOfDayUtc(new Date());
    const days = clampDays(Number(c.req.query("days")) || 7);
    const end = new Date(start.getTime() + days * DAY_MS);
    // spec §2: ?view=week (only view implemented in M1) + optional channel filter
    const view = c.req.query("view") ?? "week";
    if (view !== "week" && view !== "month") {
      throw new ApiError(400, "view must be 'week' or 'month'");
    }
    const channels = c.req.query("channels")?.split(",").filter(Boolean);
    const posts = await getCalendarEvents(deps.prisma, c.get("workspaceId"), start, end, channels);
    return c.json({ start: start.toISOString(), days, view, posts });
  });

  // --- Channels ---
  app.get("/api/channels", async (c) => {
    const channels = await listChannelsWithStatus(deps.prisma, c.get("workspaceId"));
    return c.json({ channels });
  });

  app.post("/api/channels/:slug/connect", async (c) => {
    const slug = c.req.param("slug");
    const adapter = adapters[slug];
    if (!adapter) throw new ApiError(404, `unknown channel "${slug}"`);
    const origin = new URL(c.req.url).origin;
    const redirectUri = `${origin}/api/channels/${slug}/callback`;
    const pending = startConnect(adapter, redirectUri, c.get("workspaceId"));
    setCookie(c, oauthStateCookie(slug), pending.state, {
      httpOnly: true,
      sameSite: "Lax",
      path: `/api/channels/${slug}`,
      maxAge: 600,
    });
    setCookie(c, oauthVerifierCookie(slug), pending.verifier, {
      httpOnly: true,
      sameSite: "Lax",
      path: `/api/channels/${slug}`,
      maxAge: 600,
    });
    return c.json({ url: pending.authUrl });
  });

  app.get("/api/channels/:slug/callback", async (c) => {
    const slug = c.req.param("slug");
    const adapter = adapters[slug];
    if (!adapter) throw new ApiError(404, `unknown channel "${slug}"`);

    const code = c.req.query("code");
    const state = c.req.query("state");
    const expectedState = getCookie(c, oauthStateCookie(slug));
    const verifier = getCookie(c, oauthVerifierCookie(slug));
    const accountId = c.get("accountId");

    // The state embeds the initiating workspace; resolve it for THIS account so
    // the connection lands in the right workspace even for non-default ones.
    const stateWorkspaceId = state ? workspaceIdFromState(state) : null;
    const workspace = stateWorkspaceId
      ? await deps.prisma.workspace.findFirst({ where: { id: stateWorkspaceId, accountId } })
      : null;

    const origin = new URL(c.req.url).origin;
    const redirectUri = `${origin}/api/channels/${slug}/callback`;
    const failUrl = `/${workspace?.id ?? ""}/channels?error=connect_failed`;

    if (!code || !state || !expectedState || !verifier || !workspace) {
      return c.redirect(`${failUrl}&reason=missing_params`);
    }
    try {
      await completeConnect(deps.prisma, adapter, {
        workspaceId: workspace.id,
        channelSlug: slug,
        code,
        state,
        expectedState,
        verifier,
        redirectUri,
        encryptionKey,
      });
      return c.redirect(`/${workspace.id}/channels?connected=${slug}`);
    } catch {
      return c.redirect(`${failUrl}&reason=exchange_failed`);
    }
  });

  app.delete("/api/channels/:slug", async (c) => {
    const result = await disconnectChannel(deps.prisma, c.get("workspaceId"), c.req.param("slug"));
    return c.json(result);
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error("[api] unhandled error", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}

function clampDays(days: number): number {
  if (Number.isNaN(days)) return 7;
  return Math.min(31, Math.max(1, Math.floor(days)));
}
