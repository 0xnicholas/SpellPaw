// MCP Server Phase 1 integration tests — full JSON-RPC session over the
// streamable HTTP transport, driven through the Hono app.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Context } from "hono";
import { createApiApp } from "@/server/http";
import { createPrismaClient } from "@/lib/db";
import type { Publisher } from "@/server/publisher";
import type { RateLimiter } from "@/lib/rate-limit";
import { mintApiToken } from "@/server/api-tokens";
import { resetTestSchema, TEST_DATABASE_URL } from "./setup";

const ACCOUNT = "test-account-mcp";
const WS = `ws-mcp-${ACCOUNT}`;

let prisma: ReturnType<typeof createPrismaClient>;

const noopPublisher: Publisher = {
  enqueuePublish: async () => ({ queued: 0 }),
  schedule: async () => {},
  cancelSchedule: async () => {},
  getVariantQueueState: async () => null,
  close: async () => {},
};

function makeApp(options?: { rateLimiter?: RateLimiter }) {
  return createApiApp({
    prisma,
    publisher: noopPublisher,
    encryptionKey: Buffer.from("k".repeat(32), "utf8"),
    getAccountId: (async () => null) as (c: Context) => Promise<string | null>, // cookie auth unavailable → bearer only
    rateLimiter: options?.rateLimiter,
  });
}

/** Minimal streamable-HTTP MCP client (JSON mode). */
class McpClient {
  sessionId: string | null = null;
  constructor(
    private app: ReturnType<typeof makeApp>,
    private token: string,
  ) {}

  private async post(body: unknown) {
    const res = await this.app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${this.token}`,
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify(body),
    });
    const session = res.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    return res;
  }

  async initialize(): Promise<void> {
    const res = await this.post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0.0.1" },
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe("spellpaw");
    expect(this.sessionId).toBeTruthy();
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async call<T>(id: number, method: string, params?: unknown): Promise<{ result?: T; error?: { message?: string } }> {
    const res = await this.post({ jsonrpc: "2.0", id, method, params });
    expect(res.status).toBe(200);
    return res.json() as Promise<{ result?: T; error?: { message?: string } }>;
  }
}

beforeAll(async () => {
  resetTestSchema();
  prisma = createPrismaClient(TEST_DATABASE_URL!);
  await prisma.workspace.upsert({
    where: { id: WS },
    create: {
      id: WS,
      accountId: ACCOUNT,
      name: "MCP test",
      // M5: publish approval defaults true — the schedule test opts out to
      // exercise the publisher path; a dedicated test covers the gate.
      mcpPublishApproval: false,
    },
    update: {},
  });
  for (const slug of ["twitter", "linkedin", "instagram"]) {
    await prisma.channel.upsert({ where: { slug }, update: {}, create: { slug, name: slug } });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("MCP auth", () => {
  it("rejects requests without a valid bearer token", async () => {
    const app = makeApp();
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown token", async () => {
    const app = makeApp();
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sp_bogus" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(401);
  });
});

describe("MCP tools", () => {
  it("exposes the full 5-module / 14-tool surface", async () => {
    const { token } = await mintApiToken(prisma, WS, "test");
    const client = new McpClient(makeApp(), token);
    await client.initialize();
    const { result } = await client.call<{ tools: Array<{ name: string }> }>(2, "tools/list");
    const names = result?.tools.map((t) => t.name) ?? [];
    expect(names).toHaveLength(14);
    for (const expected of [
      "post.create_draft",
      "post.list",
      "post.get",
      "post.update_variant",
      "schedule.set",
      "schedule.reschedule",
      "schedule.cancel",
      "calendar.view",
      "calendar.find_slot",
      "post.performance",
      "dashboard.summary",
      "contact.list",
      "contact.get",
      "contact.repeat_viewers",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("creates a draft post via post.create_draft", async () => {
    const { token } = await mintApiToken(prisma, WS, "test");
    const client = new McpClient(makeApp(), token);
    await client.initialize();
    const { result } = await client.call<{ structuredContent: { postId: string; status: string } }>(2, "tools/call", {
      name: "post.create_draft",
      arguments: { title: "from MCP", variants: [{ channelSlug: "twitter", content: "hello mcp world" }] },
    });
    expect(result?.structuredContent.status).toBe("DRAFT");
    const post = await prisma.post.findUniqueOrThrow({ where: { id: result!.structuredContent.postId } });
    expect(post.workspaceId).toBe(WS);
    expect(post.status).toBe("DRAFT");
  });

  it("schedule tools are gated by the publish-approval trust toggle (spec §3)", async () => {
    const { token } = await mintApiToken(prisma, WS, "test");
    const client = new McpClient(makeApp(), token);
    await client.initialize();
    const created = await client.call<{ structuredContent: { postId: string } }>(2, "tools/call", {
      name: "post.create_draft",
      arguments: { variants: [{ channelSlug: "twitter", content: "gated" }] },
    });
    const postId = created.result!.structuredContent.postId;

    // Toggle ON (default) — publish-path tools reject with an approval error.
    await prisma.workspace.update({ where: { id: WS }, data: { mcpPublishApproval: true } });
    const future = new Date(Date.now() + 3600_000).toISOString();
    const gated = await client.call<{ content?: Array<{ text?: string }>; isError?: boolean }>(3, "tools/call", {
      name: "schedule.set",
      arguments: { postId, scheduledAt: future },
    });
    expect(gated.result?.isError).toBe(true);
    expect(gated.result?.content?.[0]?.text ?? "").toContain("requires approval");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).status).toBe("DRAFT");

    // Toggle OFF (trusted mode) — the same call succeeds.
    await prisma.workspace.update({ where: { id: WS }, data: { mcpPublishApproval: false } });
    const ok = await client.call<{ structuredContent: { status: string } }>(4, "tools/call", {
      name: "schedule.set",
      arguments: { postId, scheduledAt: future },
    });
    expect(ok.error).toBeUndefined();
    expect(ok.result?.structuredContent.status).toBe("SCHEDULED");
  });

  it("schedules and cancels via schedule tools (through the publisher)", async () => {    const { token } = await mintApiToken(prisma, WS, "test");
    const client = new McpClient(makeApp(), token);
    await client.initialize();
    const created = await client.call<{ structuredContent: { postId: string } }>(2, "tools/call", {
      name: "post.create_draft",
      arguments: { variants: [{ channelSlug: "linkedin", content: "scheduled from MCP" }] },
    });
    const future = new Date(Date.now() + 3600_000).toISOString();
    const setRes = await client.call<{ structuredContent: { status: string } }>(3, "tools/call", {
      name: "schedule.set",
      arguments: { postId: created.result!.structuredContent.postId, scheduledAt: future },
    });
    expect(setRes.result?.structuredContent.status).toBe("SCHEDULED");
    const cancelRes = await client.call<{ structuredContent: { status: string } }>(4, "tools/call", {
      name: "schedule.cancel",
      arguments: { postId: created.result!.structuredContent.postId },
    });
    expect(cancelRes.result?.structuredContent.status).toBe("DRAFT");
  });

  it("contact.get never leaks profile (PII) fields even when they exist", async () => {
    const { token } = await mintApiToken(prisma, WS, "test");
    const client = new McpClient(makeApp(), token);
    await client.initialize();

    await prisma.contact.create({
      data: {
        workspaceId: WS,
        type: "AUDIENCE",
        profileName: "Alice PII",
        profileEmail: "alice-secret@example.com",
        profileSocialHandle: "@alice-secret",
        stateLifecycleStage: "ENGAGED",
        personaContentDNA: { topics: ["ai", "builders"] },
        stateRiskScore: 12,
      },
    });
    const contacts = await prisma.contact.findMany({ where: { workspaceId: WS } });
    const target = contacts[0];

    const { result } = await client.call<{ structuredContent: { contact: Record<string, unknown> } }>(2, "tools/call", {
      name: "contact.get",
      arguments: { contactId: target.id },
    });
    const contact = result!.structuredContent.contact;
    const raw = JSON.stringify(result);
    expect(raw).not.toContain("Alice PII");
    expect(raw).not.toContain("alice-secret@example.com");
    expect(raw).not.toContain("@alice-secret");
    expect(Object.keys(contact).some((k) => k.startsWith("profile"))).toBe(false);
    expect(contact.stateLifecycleStage).toBe("ENGAGED");
    expect(contact.personaContentDNA).toEqual({ topics: ["ai", "builders"] });
  });

  it("calendar.find_slot returns the earliest gap avoiding scheduled posts", async () => {
    const { token } = await mintApiToken(prisma, WS, "test");
    const client = new McpClient(makeApp(), token);
    await client.initialize();

    const start = new Date("2030-01-01T09:00:00Z");
    const end = new Date("2030-01-01T13:00:00Z");
    // Occupy 10:00–11:00.
    const post = await prisma.post.create({
      data: { workspaceId: WS, status: "SCHEDULED", scheduledAt: new Date("2030-01-01T10:00:00Z") },
    });
    await prisma.postVariant.create({
      data: { postId: post.id, channelId: (await prisma.channel.findUniqueOrThrow({ where: { slug: "twitter" } })).id, content: "x" },
    });

    const { result } = await client.call<{ structuredContent: { slot: string | null } }>(2, "tools/call", {
      name: "calendar.find_slot",
      arguments: { start: start.toISOString(), end: end.toISOString(), durationMinutes: 60 },
    });
    // 09:00 is free → earliest gap is 09:00.
    expect(result?.structuredContent.slot).toBe("2030-01-01T09:00:00.000Z");

    const late = await client.call<{ structuredContent: { slot: string | null } }>(3, "tools/call", {
      name: "calendar.find_slot",
      arguments: { start: new Date("2030-01-01T10:00:00Z").toISOString(), end: end.toISOString(), durationMinutes: 60 },
    });
    // 10:00 occupied; 11:00–12:00 free → 11:00.
    expect(late.result?.structuredContent.slot).toBe("2030-01-01T11:00:00.000Z");
  });

  it("blocks write tools once the daily cap is hit", async () => {
    let allowed = true;
    const app = makeApp({
      rateLimiter: {
        allow: async () => allowed,
      },
    });
    const { token } = await mintApiToken(prisma, WS, "test");
    const client = new McpClient(app, token);
    await client.initialize();

    const okRes = await client.call<{ structuredContent: { postId: string } }>(2, "tools/call", {
      name: "post.create_draft",
      arguments: { variants: [{ channelSlug: "twitter", content: "within cap" }] },
    });
    expect(okRes.result?.structuredContent.postId).toBeTruthy();

    allowed = false;
    const capped = await client.call<{ isError?: boolean }>(3, "tools/call", {
      name: "post.create_draft",
      arguments: { variants: [{ channelSlug: "twitter", content: "over cap" }] },
    });
    expect(capped.result?.isError).toBe(true);
  });

  it("rejects tool calls with invalid arguments (schema validation)", async () => {
    const { token } = await mintApiToken(prisma, WS, "test");
    const client = new McpClient(makeApp(), token);
    await client.initialize();
    const res = await client.call<{ isError?: boolean }>(2, "tools/call", {
      name: "post.create_draft",
      arguments: { variants: [] }, // min 1
    });
    expect(res.result?.isError).toBe(true);
  });
});
