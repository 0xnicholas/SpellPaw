// /api/inbox routes (M6, ADR-0013 "row-as-message") — the web/API surface for
// 1:1 conversations. A "thread" is a query-time aggregation over
// contact × channel; threadId = `${contactId}:${channelSlug}` (stable handle).
// PII exception domain (ADR-0014): session-authenticated API returns full
// message content + partner identity — this is the product, unlike the
// contact endpoints (which never return profile_*).
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../errors";
import { sendReply } from "../inbox";
import type { AppEnv, RouteDeps } from "./shared";
import { readJson } from "./shared";
import type { Conversation } from "@/generated/prisma/client";

const replySchema = z.object({
  content: z.string().min(1).max(2000),
});

function parseThreadId(threadId: string): { contactId: string; channelSlug: string } {
  const idx = threadId.indexOf(":");
  if (idx <= 0 || idx === threadId.length - 1) {
    throw new ApiError(400, "invalid thread id — expected contactId:channelSlug");
  }
  return { contactId: threadId.slice(0, idx), channelSlug: threadId.slice(idx + 1) };
}

type ThreadRow = Conversation & {
  contact: {
    id: string;
    type: string;
    stateLifecycleStage: string;
    profileName: string | null;
    profileSocialHandle: string | null;
    profileSourceChannel: string | null;
  };
  channel: { slug: string; name: string };
};

/** Group all workspace conversations into threads (contact × channel). */
async function listThreads(deps: RouteDeps, workspaceId: string): Promise<Array<Record<string, unknown>>> {
  const [conversations, readStates] = await Promise.all([
    deps.prisma.conversation.findMany({
      where: { workspaceId },
      include: {
        contact: {
          select: {
            id: true,
            type: true,
            stateLifecycleStage: true,
            profileName: true,
            profileSocialHandle: true,
            profileSourceChannel: true,
          },
        },
        channel: { select: { slug: true, name: true } },
      },
      orderBy: { timestamp: "desc" },
    }),
    deps.prisma.inboxReadState.findMany({ where: { workspaceId } }),
  ]);

  const lastRead = new Map(
    readStates.map((r) => [`${r.contactId}:${r.channelId}`, r.lastReadAt]),
  );
  const byThread = new Map<string, ThreadRow[]>();
  for (const c of conversations) {
    const key = `${c.contactId}:${c.channelId}`;
    const bucket = byThread.get(key) ?? [];
    bucket.push(c);
    byThread.set(key, bucket);
  }

  return Array.from(byThread.entries()).map(([key, rows]) => {
    const latest = rows[0]; // ordered desc
    const channel = latest.channel;
    const readAt = lastRead.get(key);
    const unreadCount = rows.filter(
      (r) => r.direction === "INBOUND" && (!readAt || r.timestamp > readAt),
    ).length;
    return {
      threadId: `${latest.contactId}:${channel.slug}`,
      contactId: latest.contactId,
      channelSlug: channel.slug,
      channelName: channel.name,
      contact: {
        name: latest.contact.profileName,
        handle: latest.contact.profileSocialHandle,
        sourceChannel: latest.contact.profileSourceChannel,
        lifecycleStage: latest.contact.stateLifecycleStage,
        type: latest.contact.type,
      },
      lastMessage: {
        id: latest.id,
        direction: latest.direction,
        deliveryState: latest.deliveryState,
        content: latest.content,
        timestamp: latest.timestamp.toISOString(),
      },
      messageCount: rows.length,
      unreadCount,
      lastReadAt: readAt?.toISOString() ?? null,
    };
  });
}

export function inboxRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // --- Thread list ---

  app.get("/conversations", async (c) => {
    const threads = await listThreads(deps, c.get("workspaceId"));
    // Newest activity first.
    threads.sort((a, b) =>
      (b.lastMessage as { timestamp: string }).timestamp.localeCompare(
        (a.lastMessage as { timestamp: string }).timestamp,
      ),
    );
    return c.json({ threads });
  });

  // --- Thread read (messages asc) ---

  app.get("/conversations/:threadId", async (c) => {
    const { contactId, channelSlug } = parseThreadId(c.req.param("threadId"));
    const workspaceId = c.get("workspaceId");
    const channel = await deps.prisma.channel.findUnique({ where: { slug: channelSlug } });
    if (!channel) throw new ApiError(404, "channel not found");
    const contact = await deps.prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      select: {
        id: true,
        type: true,
        stateLifecycleStage: true,
        profileName: true,
        profileSocialHandle: true,
        profileSourceChannel: true,
      },
    });
    if (!contact) throw new ApiError(404, "contact not found");

    const messages = await deps.prisma.conversation.findMany({
      where: { workspaceId, contactId, channelId: channel.id },
      orderBy: { timestamp: "asc" },
      select: {
        id: true,
        content: true,
        direction: true,
        deliveryState: true,
        errorMessage: true,
        timestamp: true,
        postId: true,
      },
    });
    return c.json({
      threadId: `${contactId}:${channelSlug}`,
      contact: {
        name: contact.profileName,
        handle: contact.profileSocialHandle,
        lifecycleStage: contact.stateLifecycleStage,
        type: contact.type,
      },
      channelSlug,
      channelName: channel.name,
      messages: messages.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() })),
    });
  });

  // --- Reply (202 via queue) ---

  app.post("/conversations/:threadId/reply", async (c) => {
    const { contactId, channelSlug } = parseThreadId(c.req.param("threadId"));
    const body = await readJson(c, replySchema);
    const result = await sendReply(deps.prisma, deps.publisher, {
      workspaceId: c.get("workspaceId"),
      contactId,
      channelSlug,
      content: body.content,
    });
    const row = await deps.prisma.conversation.findUniqueOrThrow({
      where: { id: result.conversationId },
    });
    return c.json(
      {
        conversation: {
          id: row.id,
          direction: row.direction,
          deliveryState: row.deliveryState,
          content: row.content,
          timestamp: row.timestamp.toISOString(),
        },
        state: result.state,
      },
      202,
    );
  });

  // --- Read-state cursor ---

  app.post("/conversations/:threadId/read", async (c) => {
    const { contactId, channelSlug } = parseThreadId(c.req.param("threadId"));
    const workspaceId = c.get("workspaceId");
    const channel = await deps.prisma.channel.findUnique({ where: { slug: channelSlug } });
    if (!channel) throw new ApiError(404, "channel not found");
    const contact = await deps.prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      select: { id: true },
    });
    if (!contact) throw new ApiError(404, "contact not found");

    const state = await deps.prisma.inboxReadState.upsert({
      where: {
        contactId_channelId: { contactId, channelId: channel.id },
      },
      create: { workspaceId, contactId, channelId: channel.id },
      update: { lastReadAt: new Date() },
    });
    return c.json({ lastReadAt: state.lastReadAt.toISOString() });
  });

  return app;
}
