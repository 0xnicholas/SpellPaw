// MCP Server Phase 1 (spec §3): 5 modules / 14 tools, embedded in-process
// (ADR-0010). Schedule tools go through the real Publisher (queue); contact
// tools never touch profile_* (PII) columns.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { getCalendarEvents, createPost, updateVariant, schedulePost, cancelSchedule, listPosts } from "../posts";
import { NON_PII_SELECT } from "../contact-select";
import type { Publisher } from "../publisher";
import type { RateLimiter } from "@/lib/rate-limit";
import { DAY_MS } from "@/lib/time";

export interface McpDeps {
  prisma: PrismaClient;
  publisher: Publisher;
  rateLimiter?: RateLimiter;
  /** Daily write budget per workspace (spec §3: write ops token-capped). */
  writeDailyCap?: number;
}

/** Workspace is injected per-request by the HTTP layer via authInfo.clientId. */
function ws(extra: { authInfo?: { clientId?: string } | undefined }): string {
  const id = extra.authInfo?.clientId;
  if (!id) throw new Error("missing workspace context");
  return id;
}

/** Wrap a plain object into a CallToolResult (text + structuredContent). */
function ok(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

const variantInput = z.object({
  channelSlug: z.string().min(1),
  content: z.string().min(1),
});

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: "spellpaw", version: "0.3.0" },
    { capabilities: { tools: {} } },
  );

  async function checkWriteCap(workspaceId: string): Promise<void> {
    if (!deps.rateLimiter) return;
    const cap = deps.writeDailyCap ?? 100;
    if (cap === 0) return; // unlimited (MCP_WRITE_DAILY_CAP=0)
    const allowed = await deps.rateLimiter.allow(`sp:mcp-write:${workspaceId}`, cap, 86_400);
    if (!allowed) {
      throw new Error(`daily MCP write cap (${cap}) reached for this workspace`);
    }
  }

  /**
   * Publish-path gate (spec §3): while the workspace trust toggle is off
   * (mcpPublishApproval = true, the default), schedule/cancel tools reject
   * with a clear error — the web UI stays the approved path. Turning the
   * toggle on in Settings opts the workspace into agent-triggered publishing.
   * Runs BEFORE the write cap so gated calls never burn daily quota.
   */
  async function checkPublishApproval(workspaceId: string): Promise<void> {
    const workspace = await deps.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { mcpPublishApproval: true },
    });
    if (workspace?.mcpPublishApproval) {
      throw new Error(
        "publishing via MCP requires approval — enable the trust toggle in Settings, or use the web app",
      );
    }
  }

  /** Shared by schedule.set / schedule.reschedule. */
  async function scheduleAt(
    d: McpDeps,
    extra: { authInfo?: { clientId?: string } | undefined },
    postId: string,
    scheduledAtIso: string,
  ) {
    const workspaceId = ws(extra);
    await checkPublishApproval(workspaceId);
    await checkWriteCap(workspaceId);
    const scheduledAt = new Date(scheduledAtIso);
    if (Number.isNaN(scheduledAt.getTime())) throw new Error("scheduledAt must be a valid ISO timestamp");
    const post = await schedulePost(d.prisma, d.publisher, workspaceId, postId, scheduledAt);
    return ok({ postId: post.id, status: post.status, scheduledAt: post.scheduledAt?.toISOString() });
  }

  // --- Post module (4 tools) ---

  server.registerTool(
    "post.create_draft",
    {
      title: "Create a draft post",
      description:
        "Create a new draft Post with per-channel variants. Content is validated against each channel's limits.",
      inputSchema: {
        title: z.string().max(200).optional(),
        variants: z.array(variantInput).min(1).describe("one variant per target channel"),
      },
    },
    async (args, extra) => {
      const workspaceId = ws(extra);
      await checkWriteCap(workspaceId);
      const post = await createPost(deps.prisma, {
        workspaceId,
        title: args.title ?? null,
        variants: args.variants,
      });
      return ok({ postId: post.id, status: post.status, variants: post.variants.length });
    },
  );

  server.registerTool(
    "post.list",
    {
      title: "List posts",
      description: "List the workspace's posts, newest first.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const posts = await listPosts(deps.prisma, ws(extra));
      return ok({
        posts: posts.map((p) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          scheduledAt: p.scheduledAt?.toISOString() ?? null,
          createdAt: p.createdAt.toISOString(),
        })),
      });
    },
  );

  server.registerTool(
    "post.get",
    {
      title: "Get a post",
      description: "Get a single post with its per-channel variants and publish states.",
      inputSchema: { postId: z.string().min(1) },
    },
    async (args, extra) => {
      const post = await deps.prisma.post.findFirst({
        where: { id: args.postId, workspaceId: ws(extra) },
        include: { variants: { include: { channel: true }, orderBy: { id: "asc" as const } } },
      });
      if (!post) throw new Error("post not found");
      return ok({
        post: {
          id: post.id,
          title: post.title,
          status: post.status,
          scheduledAt: post.scheduledAt?.toISOString() ?? null,
          publishedAt: post.publishedAt?.toISOString() ?? null,
          variants: post.variants.map((v) => ({
            id: v.id,
            channel: v.channel.slug,
            content: v.content,
            publishState: v.publishState,
            publishedAt: v.publishedAt?.toISOString() ?? null,
          })),
        },
      });
    },
  );

  server.registerTool(
    "post.update_variant",
    {
      title: "Update a post variant",
      description: "Replace a variant's content (resets it to draft if it was scheduled).",
      inputSchema: { variantId: z.string().min(1), content: z.string().min(1) },
    },
    async (args, extra) => {
      const workspaceId = ws(extra);
      await checkWriteCap(workspaceId);
      const variant = await updateVariant(deps.prisma, workspaceId, args.variantId, args.content);
      return ok({ variantId: variant.id, charCount: variant.charCount });
    },
  );

  // --- Schedule module (3 tools) ---

  server.registerTool(
    "schedule.set",
    {
      title: "Schedule a post",
      description: "Schedule a draft post at an ISO timestamp. Beyond 7 days the 5-minute reconciler picks it up.",
      inputSchema: { postId: z.string().min(1), scheduledAt: z.string().min(1) },
    },
    async (args, extra) => scheduleAt(deps, extra, args.postId, args.scheduledAt),
  );

  server.registerTool(
    "schedule.reschedule",
    {
      title: "Reschedule a post",
      description: "Move a scheduled post to a new time (idempotent — the old job is removed first).",
      inputSchema: { postId: z.string().min(1), scheduledAt: z.string().min(1) },
    },
    async (args, extra) => scheduleAt(deps, extra, args.postId, args.scheduledAt),
  );

  server.registerTool(
    "schedule.cancel",
    {
      title: "Cancel a schedule",
      description: "Unschedule a post (removes the scheduler job and waiting publish jobs).",
      inputSchema: { postId: z.string().min(1) },
    },
    async (args, extra) => {
      const workspaceId = ws(extra);
      await checkPublishApproval(workspaceId);
      await checkWriteCap(workspaceId);
      const post = await cancelSchedule(deps.prisma, deps.publisher, workspaceId, args.postId);
      return ok({ postId: post.id, status: post.status, scheduledAt: post.scheduledAt?.toISOString() ?? null });
    },
  );

  // --- Calendar module (2 tools) ---

  server.registerTool(
    "calendar.view",
    {
      title: "View the calendar",
      description: "Posts scheduled/published in [start, start + days). Week view by default.",
      inputSchema: {
        start: z.string().optional().describe("ISO date; defaults to today"),
        days: z.number().int().min(1).max(31).optional().describe("default 7"),
        channels: z.array(z.string()).optional().describe("filter by channel slug"),
      },
    },
    async (args, extra) => {
      const start = args.start ? new Date(args.start) : new Date();
      if (Number.isNaN(start.getTime())) throw new Error("start must be a valid ISO timestamp");
      const days = args.days ?? 7;
      const end = new Date(start.getTime() + days * DAY_MS);
      const posts = await getCalendarEvents(deps.prisma, ws(extra), start, end, args.channels);
      return ok({
        start: start.toISOString(),
        days,
        posts: posts.map((p) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          scheduledAt: p.scheduledAt?.toISOString() ?? null,
          publishedAt: p.publishedAt?.toISOString() ?? null,
        })),
      });
    },
  );

  server.registerTool(
    "calendar.find_slot",
    {
      title: "Find a free publishing slot",
      description:
        "Earliest gap of durationMinutes (default 60) inside [start, end) with no scheduled post.",
      inputSchema: {
        start: z.string().min(1),
        end: z.string().min(1),
        durationMinutes: z.number().int().min(5).max(1440).optional(),
      },
    },
    async (args, extra) => {
      const start = new Date(args.start);
      const end = new Date(args.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        throw new Error("start/end must be valid ISO timestamps with end > start");
      }
      const durationMs = (args.durationMinutes ?? 60) * 60_000;
      const posts = await getCalendarEvents(deps.prisma, ws(extra), start, end);
      const busy = posts
        .filter((p) => p.status === "SCHEDULED" && p.scheduledAt)
        .map((p) => ({ from: p.scheduledAt!.getTime(), to: p.scheduledAt!.getTime() + durationMs }))
        .sort((a, b) => a.from - b.from);

      let cursor = start.getTime();
      for (const block of busy) {
        if (block.to <= cursor) continue; // already past
        if (block.from - cursor >= durationMs) break; // gap found before this block
        cursor = Math.max(cursor, block.to);
      }
      const slotStart = cursor;
      if (slotStart + durationMs > end.getTime()) {
        return ok({ slot: null });
      }
      return ok({ slot: new Date(slotStart).toISOString() });
    },
  );

  // --- Performance module (2 tools) ---

  server.registerTool(
    "post.performance",
    {
      title: "Post performance",
      description: "Publish state + dates per variant. Click/like/share metrics arrive with M4 analytics.",
      inputSchema: { postId: z.string().min(1) },
    },
    async (args, extra) => {
      const post = await deps.prisma.post.findFirst({
        where: { id: args.postId, workspaceId: ws(extra) },
        include: { variants: { include: { channel: true } } },
      });
      if (!post) throw new Error("post not found");
      return ok({
        postId: post.id,
        publishedAt: post.publishedAt?.toISOString() ?? null,
        variants: post.variants.map((v) => ({
          channel: v.channel.slug,
          publishState: v.publishState,
          publishedAt: v.publishedAt?.toISOString() ?? null,
          errorMessage: v.errorMessage,
        })),
        clicks: 0, // M4: ContentTouch aggregation
      });
    },
  );

  server.registerTool(
    "dashboard.summary",
    {
      title: "Dashboard summary",
      description: "High-level content counts for the workspace.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const workspaceId = ws(extra);
      const [total, byStatus, next7d] = await Promise.all([
        deps.prisma.post.count({ where: { workspaceId } }),
        deps.prisma.post.groupBy({
          by: ["status"],
          where: { workspaceId },
          _count: { _all: true },
        }),
        deps.prisma.post.count({
          where: {
            workspaceId,
            status: "SCHEDULED",
            scheduledAt: { gte: new Date(), lt: new Date(Date.now() + 7 * DAY_MS) },
          },
        }),
      ]);
      const byStatusObj = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
      return ok({ totalPosts: total, byStatus: byStatusObj, scheduledNext7d: next7d });
    },
  );

  // --- Contacts module (3 tools) — PII contract: never return profile_* ---
  // Shared NON_PII_SELECT lives in src/server/contact-select.ts (single source
  // of truth with the REST routes).

  server.registerTool(
    "contact.list",
    {
      title: "List contacts",
      description:
        "Contacts in the workspace, optionally filtered by lifecycle stage (AWARE/ENGAGED/ACTIVATED/LOYAL/AT_RISK/CHURNED). Never returns PII.",
      inputSchema: {
        stage: z.enum(["AWARE", "ENGAGED", "ACTIVATED", "LOYAL", "AT_RISK", "CHURNED"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args, extra) => {
      const contacts = await deps.prisma.contact.findMany({
        where: {
          workspaceId: ws(extra),
          ...(args.stage ? { stateLifecycleStage: args.stage } : {}),
        },
        select: NON_PII_SELECT,
        orderBy: { updatedAt: "desc" },
        take: args.limit ?? 20,
      });
      return ok({ contacts });
    },
  );

  server.registerTool(
    "contact.get",
    {
      title: "Get a contact",
      description:
        "Persona + State for one contact (no PII, no profile fields, no raw interactions).",
      inputSchema: { contactId: z.string().min(1) },
    },
    async (args, extra) => {
      const contact = await deps.prisma.contact.findFirst({
        where: { id: args.contactId, workspaceId: ws(extra) },
        select: NON_PII_SELECT,
      });
      if (!contact) throw new Error("contact not found");
      return ok({ contact });
    },
  );

  server.registerTool(
    "contact.repeat_viewers",
    {
      title: "Repeat viewers",
      description: "Contacts who touched content repeatedly without a conversation. Requires ContentTouch — returns empty until M4 analytics.",
      inputSchema: {},
    },
    async () => ok({ viewers: [] }),
  );

  return server;
}
