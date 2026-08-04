// HTTP-level integration tests for the embedded Hono API, against the TEST
// database (dockerized Postgres). Runs in a single file to avoid parallel
// schema-reset races.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Context } from "hono";
import { createApiApp } from "@/server/http";
import { createPrismaClient } from "@/lib/db";
import { encryptString } from "@/lib/crypto";
import { MockAdapter } from "@/adapters/channels/mock";
import type { ChannelAdapter } from "@/adapters/channels/types";
import type { Publisher } from "@/server/publisher";
import { PermanentPublishError, publishVariantToChannel, settlePost } from "@/server/posts";
import { markVariantFailed } from "@/domain/post";
import { resetTestSchema, TEST_DATABASE_URL } from "./setup";

const ACCOUNT = "test-account-1";
const KEY = Buffer.from("k".repeat(32), "utf8");
const enc = (s: string) => encryptString(s, KEY);

/**
 * Synchronous publisher — runs the same core the BullMQ worker runs
 * (publishVariantToChannel + settlePost), so API tests stay deterministic
 * without Redis. The real queue path is covered in queue.test.ts.
 */
function syncPublisher(adapters: Record<string, ChannelAdapter>): Publisher {
  return {
    async enqueuePublish(postId, workspaceId, variantIds) {
      for (const variantId of variantIds) {
        const variant = await prisma.postVariant.findUnique({
          where: { id: variantId },
          include: { channel: true },
        });
        if (!variant) continue;
        try {
          const outcome = await publishVariantToChannel(prisma, adapters, KEY, variant, workspaceId);
          if (outcome.state === "failed") throw new Error(outcome.message);
        } catch (err) {
          if (err instanceof PermanentPublishError) continue; // already marked FAILED
          await prisma.postVariant.update({
            where: { id: variantId },
            data: markVariantFailed(err instanceof Error ? err.message : String(err)),
          });
        }
      }
      await settlePost(prisma, postId);
      return { queued: variantIds.length };
    },
    schedule: async () => {},
    cancelSchedule: async () => {},
    getVariantQueueState: async () => null,
    enqueueMockComment: async () => {},
    close: async () => {},
  };
}

function defaultAdapters() {
  return {
    twitter: new MockAdapter("twitter"),
    linkedin: new MockAdapter("linkedin"),
    instagram: new MockAdapter("instagram"),
  };
}

function makeApp(options?: {
  getAccountId?: (c: Context) => Promise<string | null>;
  adapters?: Record<string, ChannelAdapter>;
  /** No authenticated identity — for anonymous endpoints (health). */
  anonymous?: boolean;
}) {
  const adapters = options?.adapters ?? defaultAdapters();
  const app = createApiApp({
    prisma,
    encryptionKey: KEY,
    adapters,
    getAccountId: options?.getAccountId ?? (options?.anonymous ? async () => null : async () => ACCOUNT),
    publisher: syncPublisher(adapters),
  });
  return app;
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

async function seedChannels() {
  for (const [slug, name] of [
    ["twitter", "Twitter / X"],
    ["linkedin", "LinkedIn"],
    ["instagram", "Instagram"],
  ] as const) {
    await prisma.channel.upsert({ where: { slug }, update: {}, create: { slug, name } });
  }
}

/** set-cookie may contain several cookies joined with ", " — keep only name=value pairs. */
function extractCookies(setCookieHeader: string | null): string {
  if (!setCookieHeader) return "";
  return setCookieHeader
    .split(", ")
    .map((pair) => pair.split(";")[0])
    .join("; ");
}

async function upsertConnection(slug: string) {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { accountId: ACCOUNT } });
  const channel = await prisma.channel.findUniqueOrThrow({ where: { slug } });
  await prisma.oAuthConnection.upsert({
    where: { workspaceId_channelId: { workspaceId: workspace.id, channelId: channel.id } },
    update: { accessToken: enc("mock-at") },
    create: { workspaceId: workspace.id, channelId: channel.id, accessToken: enc("mock-at") },
  });
}

let prisma: ReturnType<typeof createPrismaClient>;

beforeAll(async () => {
  resetTestSchema();
  prisma = createPrismaClient(TEST_DATABASE_URL!);
  await seedChannels();
  await prisma.workspace.create({ data: { accountId: ACCOUNT, name: "Test Workspace" } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("health", () => {
  it("responds ok when the DB is reachable, anonymously (no auth identity)", async () => {
    const app = makeApp({ anonymous: true });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("sets baseline security headers on API responses", async () => {
    const app = makeApp();
    const res = await app.request("/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("auth guard", () => {
  it("rejects unauthenticated requests", async () => {
    const app = makeApp({ getAccountId: async () => null });
    const res = await jsonRequest(app, "/api/posts");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/posts", () => {
  it("creates a draft with variants and char counts", async () => {
    const app = makeApp();
    const res = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { title: "v1.2 launch", variants: [{ channelSlug: "twitter", content: "Hello world" }] },
    });
    expect(res.status).toBe(201);
    const { post } = await res.json();
    expect(post.status).toBe("DRAFT");
    expect(post.variants).toHaveLength(1);
    expect(post.variants[0].channel.slug).toBe("twitter");
    expect(post.variants[0].charCount).toBe(11);
    expect(post.variants[0].publishState).toBe("DRAFT");
  });

  it("rejects empty variant content with 400", async () => {
    const app = makeApp();
    const res = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "twitter", content: "   " }] },
    });
    expect(res.status).toBe(400);
  });

  it("rejects unknown channels with 400", async () => {
    const app = makeApp();
    const res = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "myspace", content: "hi" }] },
    });
    expect(res.status).toBe(400);
  });

  it("rejects posts without variants", async () => {
    const app = makeApp();
    const res = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [] },
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/variants/:id", () => {
  it("updates content and resets the publish state", async () => {
    const app = makeApp();
    const created = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "twitter", content: "old" }] },
    });
    const { post } = await created.json();
    const variantId = post.variants[0].id;

    const res = await jsonRequest(app, `/api/variants/${variantId}`, {
      method: "PATCH",
      body: { content: "a much longer new version of the content" },
    });
    expect(res.status).toBe(200);
    const { variant } = await res.json();
    expect(variant.charCount).toBe("a much longer new version of the content".length);
  });

  it("rejects content over the channel limit", async () => {
    const app = makeApp();
    const created = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "twitter", content: "ok" }] },
    });
    const { post } = await created.json();
    const res = await jsonRequest(app, `/api/variants/${post.variants[0].id}`, {
      method: "PATCH",
      body: { content: "x".repeat(281) },
    });
    expect(res.status).toBe(400);
  });
});

describe("publish flow", () => {
  async function publishedVariant(app: ReturnType<typeof makeApp>, postId: string, slug: string) {
    const res = await jsonRequest(app, `/api/posts/${postId}`);
    const { post } = await res.json();
    return post.variants.find((v: { channel: { slug: string } }) => v.channel.slug === slug);
  }

  it("publishes through the connected channel and flips states", async () => {
    const app = makeApp();
    // Connect the twitter channel first (service-level; HTTP flow tested below).
    await upsertConnection("twitter");

    const created = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "twitter", content: "ship it" }] },
    });
    const { post } = await created.json();

    const res = await jsonRequest(app, `/api/posts/${post.id}/publish`, { method: "POST" });
    expect(res.status).toBe(202);
    const { queued } = await res.json();
    expect(queued).toBe(1);

    const detail = await jsonRequest(app, `/api/posts/${post.id}`);
    const { post: updated } = await detail.json();
    expect(updated.status).toBe("PUBLISHED");
    expect(updated.publishedAt).toBeTruthy();
    expect(updated.variants[0].publishState).toBe("PUBLISHED");
  });

  it("fails a variant when the channel is not connected but still marks the post", async () => {
    const app = makeApp();
    const created = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "linkedin", content: "no connection here" }] },
    });
    const { post } = await created.json();

    const res = await jsonRequest(app, `/api/posts/${post.id}/publish`, { method: "POST" });
    expect(res.status).toBe(202);
    const variant = await publishedVariant(app, post.id, "linkedin");
    expect(variant.publishState).toBe("FAILED");
    expect(variant.errorMessage).toContain("not connected");

    const detail = await jsonRequest(app, `/api/posts/${post.id}`);
    const { post: updated } = await detail.json();
    expect(updated.status).toBe("DRAFT");
  });

  it("keeps publishing other channels when one adapter throws", async () => {
    const throwing: ChannelAdapter = {
      slug: "twitter",
      buildAuthUrl: () => "https://example.com/auth",
      exchangeCode: async () => ({ accessToken: "x" }),
      publish: async () => {
        throw new Error("rate limited");
      },
    };
    const app = makeApp({ adapters: { twitter: throwing, linkedin: new MockAdapter("linkedin") } });

    await upsertConnection("twitter");
    await upsertConnection("linkedin");

    const created = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: {
        variants: [
          { channelSlug: "twitter", content: "a" },
          { channelSlug: "linkedin", content: "b" },
        ],
      },
    });
    const { post } = await created.json();

    const res = await jsonRequest(app, `/api/posts/${post.id}/publish`, { method: "POST" });
    expect(res.status).toBe(202);
    const { queued } = await res.json();
    expect(queued).toBe(2);

    const linkedin = await publishedVariant(app, post.id, "linkedin");
    const twitter = await publishedVariant(app, post.id, "twitter");
    expect(linkedin.publishState).toBe("PUBLISHED");
    expect(twitter.publishState).toBe("FAILED");
    expect(twitter.errorMessage).toContain("rate limited");

    const detail = await jsonRequest(app, `/api/posts/${post.id}`);
    const { post: updated } = await detail.json();
    expect(updated.status).toBe("PUBLISHED");
  });

  it("retries failed variants on a later publish once the channel recovers", async () => {
    const throwing: ChannelAdapter = {
      slug: "twitter",
      buildAuthUrl: () => "https://example.com/auth",
      exchangeCode: async () => ({ accessToken: "x" }),
      publish: async () => {
        throw new Error("rate limited");
      },
    };
    const broken = makeApp({ adapters: { twitter: throwing } });
    await upsertConnection("twitter");

    const created = await jsonRequest(broken, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "twitter", content: "retry me" }] },
    });
    const { post } = await created.json();
    await jsonRequest(broken, `/api/posts/${post.id}/publish`, { method: "POST" });
    const first = await publishedVariant(broken, post.id, "twitter");
    expect(first.publishState).toBe("FAILED");

    // Channel recovers (all mocks now) — a second publish retries the FAILED variant.
    const recovered = makeApp();
    const second = await jsonRequest(recovered, `/api/posts/${post.id}/publish`, { method: "POST" });
    expect(second.status).toBe(202);
    const retried = await publishedVariant(recovered, post.id, "twitter");
    expect(retried.publishState).toBe("PUBLISHED");
  });

  it("rejects publishing an already-published post", async () => {
    const app = makeApp();
    await upsertConnection("twitter");
    const created = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "twitter", content: "once" }] },
    });
    const { post } = await created.json();
    await jsonRequest(app, `/api/posts/${post.id}/publish`, { method: "POST" });
    const again = await jsonRequest(app, `/api/posts/${post.id}/publish`, { method: "POST" });
    expect(again.status).toBe(400);
  });
});

describe("schedule", () => {
  it("schedules a future post", async () => {
    const app = makeApp();
    const created = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "twitter", content: "tomorrow" }] },
    });
    const { post } = await created.json();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    const res = await jsonRequest(app, `/api/schedule/${post.id}`, {
      method: "POST",
      body: { scheduledAt: future },
    });
    expect(res.status).toBe(200);
    const { post: updated } = await res.json();
    expect(updated.status).toBe("SCHEDULED");
  });

  it("rejects a past schedule", async () => {
    const app = makeApp();
    const created = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "twitter", content: "yesterday" }] },
    });
    const { post } = await created.json();
    const past = new Date(Date.now() - 86_400_000).toISOString();

    const res = await jsonRequest(app, `/api/schedule/${post.id}`, {
      method: "POST",
      body: { scheduledAt: past },
    });
    expect(res.status).toBe(400);
  });

  it("cancels a schedule back to DRAFT", async () => {
    const app = makeApp();
    const created = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "twitter", content: "maybe" }] },
    });
    const { post } = await created.json();
    await jsonRequest(app, `/api/schedule/${post.id}`, {
      method: "POST",
      body: { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    const res = await jsonRequest(app, `/api/schedule/${post.id}`, { method: "DELETE" });
    const { post: updated } = await res.json();
    expect(updated.status).toBe("DRAFT");
    expect(updated.scheduledAt).toBeNull();
  });
});

describe("calendar", () => {
  it("returns scheduled and published posts in range, excludes drafts", async () => {
    const app = makeApp();
    const now = new Date();
    const inRange = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
    const postA = await prisma.post.create({
      data: {
        workspaceId: (await prisma.workspace.findFirstOrThrow({ where: { accountId: ACCOUNT } })).id,
        status: "SCHEDULED",
        scheduledAt: inRange,
        variants: {
          create: {
            channelId: (await prisma.channel.findUniqueOrThrow({ where: { slug: "twitter" } })).id,
            content: "on the calendar",
            charCount: 16,
          },
        },
      },
    });
    await prisma.post.create({
      data: {
        workspaceId: postA.workspaceId,
        status: "DRAFT",
        variants: {
          create: {
            channelId: (await prisma.channel.findUniqueOrThrow({ where: { slug: "twitter" } })).id,
            content: "hidden draft",
            charCount: 12,
          },
        },
      },
    });

    const res = await jsonRequest(
      app,
      `/api/calendar?start=${inRange.toISOString()}&days=7`,
    );
    expect(res.status).toBe(200);
    const { posts } = await res.json();
    // Earlier tests published posts today, so assert membership + statuses
    // rather than an exact count.
    expect(posts.map((p: { id: string }) => p.id)).toContain(postA.id);
    expect(posts.every((p: { status: string }) => p.status !== "DRAFT")).toBe(true);
  });

  it("keeps overdue SCHEDULED posts in their slot (no queue in M1)", async () => {
    const app = makeApp();
    const workspace = await prisma.workspace.findFirstOrThrow({ where: { accountId: ACCOUNT } });
    const twitter = await prisma.channel.findUniqueOrThrow({ where: { slug: "twitter" } });
    const overdue = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        status: "SCHEDULED",
        scheduledAt: new Date(Date.now() - 2 * 86_400_000),
        variants: { create: { channelId: twitter.id, content: "missed slot", charCount: 11 } },
      },
    });

    const res = await jsonRequest(app, `/api/calendar?start=${new Date().toISOString()}&days=7`);
    const { posts } = await res.json();
    expect(posts.map((p: { id: string }) => p.id)).toContain(overdue.id);
  });

  it("filters calendar events by channel slug", async () => {
    const app = makeApp();
    const res = await jsonRequest(app, "/api/calendar?channels=instagram");
    const { posts } = await res.json();
    for (const p of posts as Array<{ variants: Array<{ channel: { slug: string } }> }>) {
      expect(p.variants.some((v) => v.channel.slug === "instagram")).toBe(true);
    }
  });
});

describe("post detail", () => {
  it("returns a single post with variants", async () => {
    const app = makeApp();
    const created = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "twitter", content: "detail" }] },
    });
    const { post } = await created.json();
    const res = await jsonRequest(app, `/api/posts/${post.id}`);
    expect(res.status).toBe(200);
    const { post: detail } = await res.json();
    expect(detail.variants[0].channel.slug).toBe("twitter");
  });

  it("404s for unknown posts", async () => {
    const app = makeApp();
    const res = await jsonRequest(app, "/api/posts/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("reschedule", () => {
  it("moves a scheduled post to a new time via PATCH", async () => {
    const app = makeApp();
    const created = await jsonRequest(app, "/api/posts", {
      method: "POST",
      body: { variants: [{ channelSlug: "twitter", content: "move me" }] },
    });
    const { post } = await created.json();
    await jsonRequest(app, `/api/schedule/${post.id}`, {
      method: "POST",
      body: { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const res = await jsonRequest(app, `/api/schedule/${post.id}`, {
      method: "PATCH",
      body: { scheduledAt: later },
    });
    expect(res.status).toBe(200);
    const { post: updated } = await res.json();
    expect(updated.scheduledAt).toBe(later);
  });
});

describe("channel connect flow (HTTP)", () => {
  it("connects a channel end-to-end via OAuth-style redirect", async () => {
    const app = makeApp();
    const connect = await jsonRequest(app, "/api/channels/twitter/connect", { method: "POST" });
    expect(connect.status).toBe(200);
    const { url } = await connect.json();
    const setCookie = connect.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sp_oauth_state");

    const callbackUrl = new URL(url);
    const cb = await app.request(callbackUrl.pathname + callbackUrl.search, {
      headers: { cookie: extractCookies(connect.headers.get("set-cookie")) },
    });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("/channels?connected=twitter");

    const channels = await jsonRequest(app, "/api/channels");
    const { channels: list } = await channels.json();
    const twitter = list.find((c: { slug: string }) => c.slug === "twitter");
    expect(twitter.connected).toBe(true);
    // Mock adapters don't implement fetchAccountName → no @handle, stays null.
    expect(twitter.accountName).toBeNull();
  });

  it("stores the platform account name when the adapter provides one", async () => {
    const named = {
      slug: "twitter",
      buildAuthUrl: (state: string, redirectUri: string) =>
        `${redirectUri}?code=named-code&state=${state}&challenge=named`,
      exchangeCode: async () => ({
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: new Date(Date.now() + 3600_000),
      }),
      publish: async () => ({ externalId: "t" }),
      fetchAccountName: async () => "@spellpaw_hq",
    } as unknown as MockAdapter;
    const app = makeApp({ adapters: { ...defaultAdapters(), twitter: named } });
    const connect = await jsonRequest(app, "/api/channels/twitter/connect", { method: "POST" });
    const { url } = await connect.json();
    const callbackUrl = new URL(url);
    const cbRes = await app.request(callbackUrl.pathname + callbackUrl.search, {
      headers: { cookie: extractCookies(connect.headers.get("set-cookie")) },
    });
    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.get("location")).toContain("connected=twitter");
    const channels = await jsonRequest(app, "/api/channels");
    const { channels: list } = await channels.json();
    const twitter = list.find((c: { slug: string }) => c.slug === "twitter");
    expect(twitter.accountName).toBe("@spellpaw_hq");
  });

  it("rejects a callback with a mismatched state", async () => {
    const app = makeApp();
    const connect = await jsonRequest(app, "/api/channels/linkedin/connect", { method: "POST" });

    // State format is <workspaceId>.<random> — a wrong random part resolves the
    // workspace but fails the OAuth state check.
    const workspace = await prisma.workspace.findFirstOrThrow({ where: { accountId: ACCOUNT } });
    const cb = await app.request(
      `/api/channels/linkedin/callback?code=x&state=${workspace.id}.bogus`,
      { headers: { cookie: extractCookies(connect.headers.get("set-cookie")) } },
    );
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("reason=exchange_failed");
  });

  it("disconnects a channel", async () => {
    const app = makeApp();
    const connect = await jsonRequest(app, "/api/channels/instagram/connect", { method: "POST" });
    const { url } = await connect.json();
    const callbackUrl = new URL(url);
    await app.request(callbackUrl.pathname + callbackUrl.search, {
      headers: { cookie: extractCookies(connect.headers.get("set-cookie")) },
    });

    const res = await jsonRequest(app, "/api/channels/instagram", { method: "DELETE" });
    expect(res.status).toBe(200);

    const channels = await jsonRequest(app, "/api/channels");
    const { channels: list } = await channels.json();
    expect(list.find((c: { slug: string }) => c.slug === "instagram").connected).toBe(false);
  });
});

describe("workspace scoping", () => {
  it("honors the x-workspace-id header and rejects foreign workspaces", async () => {
    const app = makeApp();
    const foreign = await prisma.workspace.create({
      data: { accountId: "another-account", name: "Foreign" },
    });
    const res = await jsonRequest(app, "/api/posts", { headers: { "x-workspace-id": foreign.id } });
    expect(res.status).toBe(404);

    const own = await prisma.workspace.findFirstOrThrow({ where: { accountId: ACCOUNT } });
    const ok = await jsonRequest(app, "/api/posts", { headers: { "x-workspace-id": own.id } });
    expect(ok.status).toBe(200);
  });
});
