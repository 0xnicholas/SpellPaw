// M6 Inbox Phase 1 REST surface (ADR-0013): thread list/read, reply (202 via
// the real queue), read-state cursor, manual activation. Runs with real
// Redis workers so replies settle PENDING → SENT.
// NOTE: do NOT run while a dev/prod server is up (worker queue stealing).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Context } from "hono";
import { createApiApp } from "@/server/http";
import { createPrismaClient } from "@/lib/db";
import { encryptString } from "@/lib/crypto";
import { MockAdapter } from "@/adapters/channels/mock";
import { createPublisher, createWorkers, type RunningWorkers } from "@/server/queue";
import type { Publisher } from "@/server/publisher";
import { recordInboundMessage } from "@/server/inbox";
import { resetTestSchema, TEST_DATABASE_URL } from "./setup";

const ACCOUNT = "inbox-api-account";
const KEY = Buffer.from("a".repeat(32), "utf8");
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let prisma: ReturnType<typeof createPrismaClient>;
let publisher: Publisher;
let workers: RunningWorkers;
let app: ReturnType<typeof createApiApp>;
let wsId: string;

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out waiting for condition");
}

async function jsonRequest(
  path: string,
  options: { method?: string; body?: unknown } = {},
) {
  return app.request(path, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

beforeAll(async () => {
  resetTestSchema();
  prisma = createPrismaClient(TEST_DATABASE_URL!);
  for (const [slug, name] of [
    ["twitter", "Twitter / X"],
    ["linkedin", "LinkedIn"],
    ["instagram", "Instagram"],
  ] as const) {
    await prisma.channel.upsert({ where: { slug }, update: {}, create: { slug, name } });
  }
  const workspace = await prisma.workspace.create({ data: { accountId: ACCOUNT, name: "Inbox API" } });
  wsId = workspace.id;
  const channel = await prisma.channel.findUniqueOrThrow({ where: { slug: "linkedin" } });
  await prisma.oAuthConnection.create({
    data: {
      workspaceId: wsId,
      channelId: channel.id,
      accessToken: encryptString("token:linkedin", KEY),
    },
  });

  const adapters = {
    twitter: new MockAdapter("twitter"),
    linkedin: new MockAdapter("linkedin"),
    instagram: new MockAdapter("instagram"),
  };
  publisher = createPublisher({ prisma, redisUrl: REDIS_URL, adapters, encryptionKey: KEY });
  workers = createWorkers({ prisma, redisUrl: REDIS_URL, adapters, encryptionKey: KEY });
  app = createApiApp({
    prisma,
    publisher,
    encryptionKey: KEY,
    adapters,
    getAccountId: (async () => ACCOUNT) as (c: Context) => Promise<string | null>,
  });
});

afterAll(async () => {
  await workers.close();
  await prisma.$disconnect();
});

describe("GET /api/inbox/conversations", () => {
  it("returns empty until inbound messages exist", async () => {
    const res = await jsonRequest("/api/inbox/conversations");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threads: unknown[] };
    expect(body.threads).toEqual([]);
  });

  it("lists threads with partner identity, last message and unread count", async () => {
    await recordInboundMessage(prisma, {
      workspaceId: wsId,
      channelSlug: "linkedin",
      content: "Do you offer a free trial?",
      externalId: "api-ext:q1",
      sender: { name: "Grace Hopper", handle: "ghopper" },
    });

    const res = await jsonRequest("/api/inbox/conversations");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      threads: Array<{
        contactId: string;
        threadId: string;
        contact: { name: string; handle: string };
        channelSlug: string;
        lastMessage: { content: string; direction: string };
        unreadCount: number;
      }>;
    };
    expect(body.threads).toHaveLength(1);
    const thread = body.threads[0]!;
    expect(thread.threadId).toBe(`${thread.contactId}:linkedin`);
    expect(thread.contact.name).toBe("Grace Hopper");
    expect(thread.contact.handle).toBe("ghopper");
    expect(thread.channelSlug).toBe("linkedin");
    expect(thread.lastMessage.content).toBe("Do you offer a free trial?");
    expect(thread.lastMessage.direction).toBe("INBOUND");
    expect(thread.unreadCount).toBe(1);
  });
});

describe("GET /api/inbox/conversations/:threadId", () => {
  it("returns the full message history oldest-first", async () => {
    const contact = await prisma.contact.findFirstOrThrow({ where: { workspaceId: wsId } });
    const res = await jsonRequest(`/api/inbox/conversations/${contact.id}:linkedin`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      messages: Array<{ direction: string; content: string }>;
      contact: { name: string };
    };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.direction).toBe("INBOUND");
    expect(body.contact.name).toBe("Grace Hopper");
  });

  it("404s for a foreign contact", async () => {
    const res = await jsonRequest("/api/inbox/conversations/does-not-exist:linkedin");
    expect(res.status).toBe(404);
  });

  it("400s for a malformed thread id", async () => {
    const res = await jsonRequest("/api/inbox/conversations/nocolon");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/inbox/conversations/:threadId/reply", () => {
  it("202s, creates a PENDING row and the worker settles it SENT", async () => {
    const contact = await prisma.contact.findFirstOrThrow({ where: { workspaceId: wsId } });
    const res = await jsonRequest(`/api/inbox/conversations/${contact.id}:linkedin/reply`, {
      method: "POST",
      body: { content: "Yes — 14 days free, no card needed." },
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      conversation: { id: string; deliveryState: string; direction: string };
      state: string;
    };
    expect(body.conversation.direction).toBe("OUTBOUND");
    expect(body.state).toBe("queued");

    await waitFor(async () => {
      const row = await prisma.conversation.findUnique({ where: { id: body.conversation.id } });
      return row?.deliveryState === "SENT";
    });
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: body.conversation.id } });
    expect(row.deliveryState).toBe("SENT");
    expect(row.content).toBe("Yes — 14 days free, no card needed.");
  });

  it("rejects replies without an existing thread", async () => {
    const contact = await prisma.contact.create({ data: { workspaceId: wsId } });
    const res = await jsonRequest(`/api/inbox/conversations/${contact.id}:twitter/reply`, {
      method: "POST",
      body: { content: "hello?" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("no inbound message");
  });

  it("validates empty content", async () => {
    const contact = await prisma.contact.findFirstOrThrow({ where: { workspaceId: wsId } });
    const res = await jsonRequest(`/api/inbox/conversations/${contact.id}:linkedin/reply`, {
      method: "POST",
      body: { content: "" },
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/inbox/conversations/:threadId/read", () => {
  it("marks the thread read and clears the unread count", async () => {
    const contact = await prisma.contact.findFirstOrThrow({ where: { workspaceId: wsId } });
    const res = await jsonRequest(`/api/inbox/conversations/${contact.id}:linkedin/read`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lastReadAt: string };
    expect(body.lastReadAt).toBeTruthy();

    const list = (await (await jsonRequest("/api/inbox/conversations")).json()) as {
      threads: Array<{ unreadCount: number }>;
    };
    expect(list.threads[0]?.unreadCount).toBe(0);
  });
});

describe("POST /api/contacts/:id/activate", () => {
  it("activates a contact (sticky) and records the timeline event", async () => {
    const contact = await prisma.contact.create({ data: { workspaceId: wsId } });
    const res = await jsonRequest(`/api/contacts/${contact.id}/activate`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stateLifecycleStage: string; ok: boolean };
    expect(body.ok).toBe(true);
    expect(body.stateLifecycleStage).toBe("ACTIVATED");

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.stateLifecycleStage).toBe("ACTIVATED");
    expect(
      await prisma.event.count({ where: { contactId: contact.id, eventType: "MANUAL_ACTIVATION" } }),
    ).toBe(1);
  });

  it("404s for a foreign contact", async () => {
    const res = await jsonRequest("/api/contacts/does-not-exist/activate", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
