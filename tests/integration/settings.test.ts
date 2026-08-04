// Integration tests for M3 settings surface: model keys (BYOK), API tokens,
// AI generate, and the Redis rate limiter. Runs against the TEST database.
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "@/server/http";
import { createPrismaClient } from "@/lib/db";
import { MockAdapter } from "@/adapters/channels/mock";
import type { Publisher } from "@/server/publisher";
import type { RateLimiter } from "@/lib/rate-limit";
import {
  hashToken,
  mintApiToken,
  resolveApiToken,
  revokeApiToken,
} from "@/server/api-tokens";
import { resetTestSchema, TEST_DATABASE_URL } from "./setup";

const ACCOUNT = "test-account-m3";
const KEY = Buffer.from("k".repeat(32), "utf8");

let prisma: ReturnType<typeof createPrismaClient>;

const noopPublisher: Publisher = {
  enqueuePublish: async () => ({ queued: 0 }),
  schedule: async () => {},
  cancelSchedule: async () => {},
  getVariantQueueState: async () => null,
  enqueueMockComment: async () => {},
  enqueueReply: async () => {},
  close: async () => {},
};

function makeApp(options?: {
  rateLimiter?: RateLimiter;
  aiGenerate?: (opts: { provider: string; apiKey: string; text: string; channelSlug?: string }) => Promise<string>;
}) {
  const adapters = {
    twitter: new MockAdapter("twitter"),
    linkedin: new MockAdapter("linkedin"),
    instagram: new MockAdapter("instagram"),
  };
  return createApiApp({
    prisma,
    encryptionKey: KEY,
    adapters,
    publisher: noopPublisher,
    getAccountId: async () => ACCOUNT,
    rateLimiter: options?.rateLimiter,
    aiGenerate: options?.aiGenerate,
  });
}

async function jsonRequest(
  app: ReturnType<typeof makeApp>,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  return app.request(path, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

beforeAll(async () => {
  resetTestSchema();
  prisma = createPrismaClient(TEST_DATABASE_URL!);
  await prisma.workspace.upsert({
    where: { id: `ws-m3-${ACCOUNT}` },
    create: { id: `ws-m3-${ACCOUNT}`, accountId: ACCOUNT, name: "M3 test" },
    update: {},
  });
});

// Tests share one workspace — clear per-test state so ordering never matters.
beforeEach(async () => {
  await prisma.modelProviderKey.deleteMany({ where: { workspaceId: `ws-m3-${ACCOUNT}` } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("workspace settings + free-plan guardrails (M5)", () => {
  const WS = `ws-m3-${ACCOUNT}`;

  beforeEach(async () => {
    await prisma.post.deleteMany({ where: { workspaceId: WS } });
    await prisma.oAuthConnection.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.update({ where: { id: WS }, data: { name: "M3 test", mcpPublishApproval: true } });
  });

  it("GET /api/settings/workspace returns settings + plan usage", async () => {
    const app = makeApp();
    const res = await jsonRequest(app, "/api/settings/workspace", {
      headers: { "x-workspace-id": WS },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspace: { name: string; mcpPublishApproval: boolean };
      limits: { maxPosts: number; maxContacts: number; usedPosts: number; usedContacts: number };
    };
    expect(body.workspace.name).toBe("M3 test");
    expect(body.workspace.mcpPublishApproval).toBe(true);
    expect(body.limits.maxPosts).toBe(50);
    expect(body.limits.maxContacts).toBe(1000);
    expect(body.limits.usedPosts).toBe(0);
    expect(body.limits.usedContacts).toBe(0);
  });

  it("PATCH /api/settings/workspace updates name and the MCP trust toggle", async () => {
    const app = makeApp();
    const res = await jsonRequest(app, "/api/settings/workspace", {
      method: "PATCH",
      body: { name: "Renamed", mcpPublishApproval: false },
      headers: { "x-workspace-id": WS },
    });
    expect(res.status).toBe(200);
    const { workspace } = (await res.json()) as { workspace: { name: string; mcpPublishApproval: boolean } };
    expect(workspace.name).toBe("Renamed");
    expect(workspace.mcpPublishApproval).toBe(false);

    // empty patch is a no-op, still 200
    const noop = await jsonRequest(app, "/api/settings/workspace", {
      method: "PATCH",
      body: {},
      headers: { "x-workspace-id": WS },
    });
    expect(noop.status).toBe(200);
  });

  it("rejects post creation past the FREE_PLAN_MAX_POSTS budget", async () => {
    const app = makeApp();
    await prisma.post.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        workspaceId: WS,
        status: "DRAFT",
        title: `seed ${i}`,
      })),
    });
    const res = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { title: "over budget", variants: [{ channelSlug: "twitter", content: "hello" }] },
      headers: { "x-workspace-id": WS },
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("post limit reached");
  });
});

describe("model keys", () => {
  it("saves a key encrypted and lists only the preview", async () => {
    const app = makeApp();
    const res = await jsonRequest(app, "/api/settings/model-keys", {
      method: "POST",
      body: { provider: "openai", apiKey: "sk-test-abcdef123456" },
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    expect(res.status).toBe(201);
    const { key } = (await res.json()) as { key: { keyPreview: string; provider: string } };
    expect(key.keyPreview).toBe("sk-…3456");
    expect(JSON.stringify(key)).not.toContain("sk-test-abcdef123456");

    // at-rest: encrypted, plaintext unrecoverable via API
    const raw = await prisma.modelProviderKey.findFirstOrThrow({ where: { workspaceId: `ws-m3-${ACCOUNT}` } });
    expect(raw.encryptedKey).not.toContain("sk-test-abcdef123456");
    const listRes = await jsonRequest(app, "/api/settings/model-keys", {
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    const { keys } = (await listRes.json()) as { keys: Array<{ provider: string }> };
    expect(keys.map((k) => k.provider)).toContain("openai");
  });

  it("rejects unknown providers and short keys", async () => {
    const app = makeApp();
    const badProvider = await jsonRequest(app, "/api/settings/model-keys", {
      method: "POST",
      body: { provider: "google", apiKey: "sk-abcdefghij" },
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    expect(badProvider.status).toBe(400);
    const short = await jsonRequest(app, "/api/settings/model-keys", {
      method: "POST",
      body: { provider: "openai", apiKey: "abc" },
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    expect(short.status).toBe(400);
  });

  it("deletes a key", async () => {
    const app = makeApp();
    const created = await jsonRequest(app, "/api/settings/model-keys", {
      method: "POST",
      body: { provider: "anthropic", apiKey: "sk-ant-deleteme123" },
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    const { key } = (await created.json()) as { key: { id: string } };
    const del = await jsonRequest(app, `/api/settings/model-keys/${key.id}`, {
      method: "DELETE",
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    expect(del.status).toBe(200);
    const gone = await jsonRequest(app, `/api/settings/model-keys/${key.id}`, {
      method: "DELETE",
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    expect(gone.status).toBe(404);
  });
});

describe("api tokens", () => {
  it("mints a token, stores only the hash, resolves until revoked", async () => {
    const ws = `ws-m3-${ACCOUNT}`;
    const { token, view } = await mintApiToken(prisma, ws, "claude desktop");
    expect(token).toMatch(/^sp_[1-9A-HJ-NP-Za-km-z]{20,}$/);
    expect(view.name).toBe("claude desktop");

    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toContain(token);

    expect(await resolveApiToken(prisma, token)).toEqual({ workspaceId: ws, tokenId: view.id });
    expect(await resolveApiToken(prisma, "sp_bogus")).toBeNull();

    await revokeApiToken(prisma, ws, view.id);
    expect(await resolveApiToken(prisma, token)).toBeNull();
  });

  it("lists only non-revoked tokens", async () => {
    const ws = `ws-m3-${ACCOUNT}`;
    const a = await mintApiToken(prisma, ws, "one");
    await revokeApiToken(prisma, ws, a.view.id);
    await mintApiToken(prisma, ws, "two");
    const listRes = await jsonRequest(makeApp(), "/api/settings/api-tokens", {
      headers: { "x-workspace-id": ws },
    });
    const { tokens } = (await listRes.json()) as { tokens: Array<{ name: string }> };
    expect(tokens.map((t) => t.name)).not.toContain("one");
    expect(tokens.map((t) => t.name)).toContain("two");
  });
});

describe("contacts routes", () => {
  it("validates the stage filter: 400 on invalid, case-insensitive on valid", async () => {
    const app = makeApp();
    const ws = `ws-m3-${ACCOUNT}`;
    const bad = await jsonRequest(app, "/api/contacts?stage=FOO", { headers: { "x-workspace-id": ws } });
    expect(bad.status).toBe(400);
    const ok = await jsonRequest(app, "/api/contacts?stage=engaged", { headers: { "x-workspace-id": ws } });
    expect(ok.status).toBe(200);
    const data = (await ok.json()) as { contacts: unknown[] };
    expect(Array.isArray(data.contacts)).toBe(true);
  });
});

describe("ai/generate", () => {
  async function seedKey(app: ReturnType<typeof makeApp>) {
    await jsonRequest(app, "/api/settings/model-keys", {
      method: "POST",
      body: { provider: "openai", apiKey: "sk-test-generate123456" },
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
  }

  it("uses the workspace's active key and returns the generated text", async () => {
    const calls: Array<{ provider: string; apiKey: string }> = [];
    const app = makeApp({
      aiGenerate: async (opts) => {
        calls.push({ provider: opts.provider, apiKey: opts.apiKey });
        return "generated tweet";
      },
    });
    await seedKey(app);
    const res = await jsonRequest(app, "/api/ai/generate", {
      method: "POST",
      body: { text: "my source text", channelSlug: "twitter" },
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    expect(res.status).toBe(200);
    const { content } = (await res.json()) as { content: string };
    expect(content).toBe("generated tweet");
    expect(calls).toEqual([{ provider: "openai", apiKey: "sk-test-generate123456" }]);
  });

  it("returns 400 MODEL_KEY_MISSING when no active key exists", async () => {
    const app = makeApp({ aiGenerate: async () => "x" });
    const res = await jsonRequest(app, "/api/ai/generate", {
      method: "POST",
      body: { text: "hello" },
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("MODEL_KEY_MISSING");
  });

  it("maps provider errors to their codes (MODEL_KEY_INVALID etc.)", async () => {
    const app = makeApp({
      aiGenerate: async () => {
        throw new (await import("@/lib/ai/providers")).AiProviderError("MODEL_KEY_QUOTA", "quota");
      },
    });
    await seedKey(app);
    const res = await jsonRequest(app, "/api/ai/generate", {
      method: "POST",
      body: { text: "hello" },
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("MODEL_KEY_QUOTA");
  });

  it("deactivates a key on MODEL_KEY_INVALID (ADR-0005 degradation)", async () => {
    const app = makeApp({
      aiGenerate: async () => {
        throw new (await import("@/lib/ai/providers")).AiProviderError("MODEL_KEY_INVALID", "bad key");
      },
    });
    await seedKey(app);
    const res = await jsonRequest(app, "/api/ai/generate", {
      method: "POST",
      body: { text: "hello" },
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    expect(res.status).toBe(400);
    const key = await prisma.modelProviderKey.findFirstOrThrow({
      where: { workspaceId: `ws-m3-${ACCOUNT}` },
    });
    expect(key.isActive).toBe(false);
    expect(key.lastChecked).toBeTruthy();
    // Next attempt now reports MODEL_KEY_MISSING (no active key left).
    const again = await jsonRequest(app, "/api/ai/generate", {
      method: "POST",
      body: { text: "hello" },
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe("MODEL_KEY_MISSING");
  });

  it("rate-limits per workspace (10/min)", async () => {
    let calls = 0;
    let allowed = true;
    const app = makeApp({
      rateLimiter: {
        allow: async () => {
          calls += 1;
          return allowed;
        },
      },
      aiGenerate: async () => "x",
    });
    await seedKey(app);
    const res = await jsonRequest(app, "/api/ai/generate", {
      method: "POST",
      body: { text: "hello" },
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
    allowed = false;
    const limited = await jsonRequest(app, "/api/ai/generate", {
      method: "POST",
      body: { text: "hello" },
      headers: { "x-workspace-id": `ws-m3-${ACCOUNT}` },
    });
    expect(limited.status).toBe(429);
  });
});
