// M4 graph integration: short links (ADR-0009), click attribution pipeline
// (ContentTouch + visitor contact + rules-driven stage), analytics API, and
// repeat-viewers insight. Requires Postgres + Redis (same as queue.test.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db";
import type { PrismaClient } from "@/generated/prisma/client";
import { createApiApp } from "@/server/http";
import { createPublisher } from "@/server/queue";
import { applyClick } from "@/server/interactions";
import { createShortLink, shortLinkUrl, resolveShortLink } from "@/server/shortlinks";
import { createShortLinkHandler } from "@/app/s/[code]/route";
import { resetTestSchema, TEST_DATABASE_URL } from "./setup";

const ACCOUNT = "m4-account";
const WS = `ws-m4-${ACCOUNT}`;
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

// In-memory fake cache (unit-style) — the redirect route itself is smoke-tested
// via the dev server; the resolver's cache/DB fallback logic is covered here.
const memCache = new Map<string, { v: string; exp: number }>();
const fakeCache = {
  get: async (k: string) => {
    const hit = memCache.get(k);
    if (!hit) return null;
    if (Date.now() > hit.exp) {
      memCache.delete(k);
      return null;
    }
    return hit.v;
  },
  set: async (k: string, v: string, ttlSec: number) => {
    memCache.set(k, { v, exp: Date.now() + ttlSec * 1000 });
  },
};

let prisma: PrismaClient;

function makeApp() {
  const publisher = createPublisher({
    prisma,
    adapters: { twitter: {} as never },
    encryptionKey: Buffer.from("a".repeat(32)),
    redisUrl,
  });
  return createApiApp({
    prisma,
    publisher,
    getAccountId: async () => ACCOUNT,
  });
}

beforeAll(async () => {
  resetTestSchema();
  prisma = createPrismaClient(TEST_DATABASE_URL!);
  await prisma.workspace.create({ data: { id: WS, accountId: ACCOUNT, name: "M4" } });
  await prisma.channel.upsert({
    where: { slug: "twitter" },
    update: {},
    create: { slug: "twitter", name: "Twitter / X" },
  });
  await prisma.channel.upsert({
    where: { slug: "linkedin" },
    update: {},
    create: { slug: "linkedin", name: "LinkedIn" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Clean slate between tests (contacts, touches, posts, links, variants).
  await prisma.contentTouch.deleteMany({ where: { post: { workspaceId: WS } } });
  await prisma.contact.deleteMany({ where: { workspaceId: WS } });
  await prisma.shortLink.deleteMany({ where: { workspaceId: WS } });
  await prisma.postVariant.deleteMany({ where: { post: { workspaceId: WS } } });
  await prisma.post.deleteMany({ where: { workspaceId: WS } });
  memCache.clear();
});

async function seedPost(title: string, channelSlug = "twitter") {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { slug: channelSlug } });
  return prisma.post.create({
    data: {
      workspaceId: WS,
      title,
      status: "PUBLISHED",
      publishedAt: new Date(),
      variants: {
        create: {
          channelId: channel.id,
          content: "hello world",
          publishState: "PUBLISHED",
          publishedAt: new Date(),
        },
      },
    },
    include: { variants: true },
  });
}

async function jsonRequest(
  app: ReturnType<typeof makeApp>,
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const res = await app.fetch(
    new Request(`http://test.local${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": WS,
        ...(opts.headers ?? {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("short links", () => {
  it("creates a link per variant (idempotent) with a 6-char code", async () => {
    const post = await seedPost("Launch");
    const v = post.variants[0]!;
    const a = await createShortLink(prisma, WS, post.id, v.id, "https://example.com/launch");
    const b = await createShortLink(prisma, WS, post.id, v.id, "https://example.com/launch");
    expect(a.code).toMatch(/^[A-Za-z0-9_-]{6}$/);
    expect(a.id).toBe(b.id);
    expect(shortLinkUrl("http://localhost:3000/", a.code)).toMatch(
      /^http:\/\/localhost:3000\/s\/[A-Za-z0-9_-]{6}$/,
    );
  });

  it("resolves via cache then falls back to the DB", async () => {
    const post = await seedPost("Launch");
    const link = await createShortLink(prisma, WS, post.id, post.variants[0]!.id, "https://example.com/x");
    expect(memCache.size).toBe(0);
    const first = await resolveShortLink(prisma, link.code, fakeCache);
    expect(first?.targetUrl).toBe("https://example.com/x");
    expect(memCache.size).toBe(1); // populated on miss
    await prisma.shortLink.delete({ where: { id: link.id } });
    const second = await resolveShortLink(prisma, link.code, fakeCache);
    expect(second?.targetUrl).toBe("https://example.com/x"); // cache hit, DB gone
    const third = await resolveShortLink(prisma, "missing", fakeCache);
    expect(third).toBeNull();
  });
});

describe("click pipeline (applyClick)", () => {
  it("creates the visitor contact on first click and records the touch", async () => {
    const post = await seedPost("P1");
    const v = post.variants[0]!;
    await applyClick(prisma, { workspaceId: WS, contactId: "c1", postId: post.id, variantId: v.id });
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: "c1" } });
    expect(contact.workspaceId).toBe(WS);
    expect(contact.profileSourceChannel).toBe("twitter");
    expect(contact.stateLifecycleStage).toBe("AWARE");
    const touch = await prisma.contentTouch.findFirstOrThrow({ where: { postId: post.id } });
    expect(touch.contactId).toBe("c1");
    expect(touch.variantId).toBe(v.id);
    expect(contact.personaContentDNA).toMatchObject({
      actionCounts: { CLICK: 1 },
      distinctPosts: 1,
    });
  });

  it("promotes to ENGAGED after 3 touches in 30 days (cumulative, not distinct); anonymous clicks still count", async () => {
    const p1 = await seedPost("P1");
    const p2 = await seedPost("P2", "linkedin");
    // M6 rule (ADR-0013): ≥3 cumulative touches within 30 days — repeat clicks
    // on the same post count, distinct posts don't.
    await applyClick(prisma, { workspaceId: WS, contactId: "c2", postId: p1.id, variantId: p1.variants[0]!.id });
    await applyClick(prisma, { workspaceId: WS, contactId: "c2", postId: p1.id, variantId: p1.variants[0]!.id });
    await applyClick(prisma, { workspaceId: WS, contactId: "c2", postId: p2.id, variantId: p2.variants[0]!.id });
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: "c2" } });
    expect(contact.stateLifecycleStage).toBe("ENGAGED");
    const persona = contact.personaContentDNA as { distinctPosts: number };
    expect(persona.distinctPosts).toBe(2);

    await applyClick(prisma, { workspaceId: WS, contactId: null, postId: p1.id, variantId: p1.variants[0]!.id });
    const anonymous = await prisma.contentTouch.findMany({ where: { contactId: null, postId: p1.id } });
    expect(anonymous).toHaveLength(1);
  });

  it("reuses the same contact across clicks (visitor cookie identity)", async () => {
    const p1 = await seedPost("P1");
    const p2 = await seedPost("P2");
    await applyClick(prisma, { workspaceId: WS, contactId: "c3", postId: p1.id, variantId: p1.variants[0]!.id });
    await applyClick(prisma, { workspaceId: WS, contactId: "c3", postId: p2.id, variantId: p2.variants[0]!.id });
    const contacts = await prisma.contact.count({ where: { workspaceId: WS } });
    expect(contacts).toBe(1);
  });
});

describe("redirect route (cookie loop)", () => {
  it("degrades to an anonymous touch when the contact budget is exhausted (never blocks the redirect)", async () => {
    const post = await seedPost("Budget");
    const v = post.variants[0]!;
    const link = await createShortLink(prisma, WS, post.id, v.id, "https://example.com/budget");
    const handler = createShortLinkHandler({ prisma, redisUrl });

    const prev = process.env.FREE_PLAN_MAX_CONTACTS;
    process.env.FREE_PLAN_MAX_CONTACTS = "1";
    try {
      const first = await handler(new Request(`http://test.local/s/${link.code}`), {
        params: Promise.resolve({ code: link.code }),
      });
      expect(first.status).toBe(301);
      expect(first.headers.get("set-cookie")).toContain("sp_c=");
      expect(await prisma.contact.count({ where: { workspaceId: WS } })).toBe(1);

      // Budget spent — the redirect still 301s but stops creating contacts.
      const second = await handler(new Request(`http://test.local/s/${link.code}`), {
        params: Promise.resolve({ code: link.code }),
      });
      expect(second.status).toBe(301);
      expect(second.headers.get("set-cookie")).toBeNull();
      expect(await prisma.contact.count({ where: { workspaceId: WS } })).toBe(1);
    } finally {
      process.env.FREE_PLAN_MAX_CONTACTS = prev;
    }
  });

  it("301s, sets the visitor cookie, and reuses the contact on the next click", async () => {
    const post = await seedPost("Loop");
    const v = post.variants[0]!;
    const link = await createShortLink(prisma, WS, post.id, v.id, "https://example.com/loop");
    const handler = createShortLinkHandler({ prisma, redisUrl });

    const first = await handler(new Request(`http://test.local/s/${link.code}`), {
      params: Promise.resolve({ code: link.code }),
    });
    expect(first.status).toBe(301);
    expect(first.headers.get("location")).toBe("https://example.com/loop");
    const setCookie = first.headers.get("set-cookie") ?? "";
    const match = setCookie.match(/sp_c=([^;]+)/);
    expect(match).toBeTruthy();
    const contactId = decodeURIComponent(match![1]!);

    // The contact row exists immediately (created synchronously at redirect).
    const created = await prisma.contact.findUnique({ where: { id: contactId } });
    expect(created?.workspaceId).toBe(WS);

    // Second click with the cookie reuses the same contact — no new row.
    const second = await handler(
      new Request(`http://test.local/s/${link.code}`, {
        headers: { cookie: `sp_c=${contactId}` },
      }),
      { params: Promise.resolve({ code: link.code }) },
    );
    expect(second.status).toBe(301);
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(await prisma.contact.count({ where: { workspaceId: WS } })).toBe(1);

    // Foreign-workspace cookie id is not reused.
    const third = await handler(
      new Request(`http://test.local/s/${link.code}`, {
        headers: { cookie: `sp_c=some-foreign-id` },
      }),
      { params: Promise.resolve({ code: link.code }) },
    );
    expect(third.status).toBe(301);
    expect(await prisma.contact.count({ where: { workspaceId: WS } })).toBe(2);

    // Malformed cookie value does not 500.
    const malformed = await handler(
      new Request(`http://test.local/s/${link.code}`, {
        headers: { cookie: `sp_c=%zz` },
      }),
      { params: Promise.resolve({ code: link.code }) },
    );
    expect(malformed.status).toBe(301);
  });
});

describe("shorten + analytics API", () => {
  it("POST /api/shorten is idempotent and validates ownership", async () => {
    const app = makeApp();
    const post = await seedPost("API");
    const v = post.variants[0]!;
    const res = await jsonRequest(app, "/api/shorten", {
      method: "POST",
      body: { postId: post.id, variantId: v.id, targetUrl: "https://example.com/api" },
    });
    expect(res.status).toBe(200);
    const body = res.body as { code: string; url: string };
    expect(body.url).toMatch(/\/s\/[A-Za-z0-9_-]{6}$/);
    const again = await jsonRequest(app, "/api/shorten", {
      method: "POST",
      body: { postId: post.id, variantId: v.id, targetUrl: "https://example.com/api" },
    });
    expect((again.body as { code: string }).code).toBe(body.code);

    // Foreign variant → 404.
    const other = await prisma.workspace.create({
      data: { id: `${WS}-other`, accountId: "someone-else", name: "Other" },
    });
    void other;
    const foreign = await prisma.post.create({
      data: {
        workspaceId: `${WS}-other`,
        title: "foreign",
        variants: {
          create: { channelId: (await prisma.channel.findUniqueOrThrow({ where: { slug: "twitter" } })).id, content: "x" },
        },
      },
      include: { variants: true },
    });
    const denied = await jsonRequest(app, "/api/shorten", {
      method: "POST",
      body: { postId: foreign.id, variantId: foreign.variants[0]!.id, targetUrl: "https://evil.example" },
    });
    expect(denied.status).toBe(404);
    // Cleanup foreign workspace
    await prisma.postVariant.deleteMany({ where: { post: { workspaceId: `${WS}-other` } } });
    await prisma.post.deleteMany({ where: { workspaceId: `${WS}-other` } });
    await prisma.workspace.delete({ where: { id: `${WS}-other` } });
  });

  it("GET /api/analytics/dashboard rolls up touches, stages, top posts", async () => {
    const app = makeApp();
    const p1 = await seedPost("Launch");
    const p2 = await seedPost("Update");
    for (const [contactId, posts] of [
      ["c-a", [p1]],
      ["c-b", [p1, p2]],
    ] as const) {
      for (const p of posts) {
        await applyClick(prisma, { workspaceId: WS, contactId: contactId as string, postId: p.id, variantId: p.variants[0]!.id });
      }
    }
    await applyClick(prisma, { workspaceId: WS, contactId: null, postId: p2.id, variantId: p2.variants[0]!.id });
    const res = await jsonRequest(app, "/api/analytics/dashboard");
    expect(res.status).toBe(200);
    const d = res.body as {
      totalTouches: number;
      uniqueContacts: number;
      repeatViewers: number;
      stageDistribution: Array<{ stage: string; count: number }>;
      topPosts: Array<{ postId: string; clicks: number }>;
      touchesByDay: Array<{ day: string; clicks: number }>;
    };
    expect(d.totalTouches).toBe(4);
    expect(d.uniqueContacts).toBe(2);
    expect(d.repeatViewers).toBe(1); // c-b touched 2 distinct posts
    // M6 rule: c-b has 2 touches (below the ≥3 threshold) — both contacts AWARE.
    expect(d.stageDistribution).toEqual(
      expect.arrayContaining([{ stage: "AWARE", count: 2 }]),
    );
    expect(d.topPosts[0]?.clicks).toBe(2); // p1 touched by c-a + c-b
    expect(d.touchesByDay.length).toBeGreaterThan(0);
  });

  it("GET /api/analytics/posts/:id breaks clicks down per variant", async () => {
    const app = makeApp();
    const p1 = await seedPost("Launch");
    const p2 = await seedPost("Update", "linkedin");
    await applyClick(prisma, { workspaceId: WS, contactId: "c-x", postId: p1.id, variantId: p1.variants[0]!.id });
    await applyClick(prisma, { workspaceId: WS, contactId: "c-y", postId: p1.id, variantId: p1.variants[0]!.id });
    const res = await jsonRequest(app, `/api/analytics/posts/${p1.id}`);
    expect(res.status).toBe(200);
    const d = res.body as { variants: Array<{ channelSlug: string; clicks: number }>; recentTouches: unknown[] };
    expect(d.variants).toEqual([{ channelSlug: "twitter", clicks: 2 }]);
    expect(d.recentTouches).toHaveLength(2);
    void p2;
  });

  it("GET /api/contacts/insights/repeat-viewers returns real viewers (no PII)", async () => {
    const app = makeApp();
    const p1 = await seedPost("Launch");
    const p2 = await seedPost("Update");
    await applyClick(prisma, { workspaceId: WS, contactId: "c-r1", postId: p1.id, variantId: p1.variants[0]!.id });
    await applyClick(prisma, { workspaceId: WS, contactId: "c-r1", postId: p2.id, variantId: p2.variants[0]!.id });
    await applyClick(prisma, { workspaceId: WS, contactId: "c-r2", postId: p1.id, variantId: p1.variants[0]!.id });
    const res = await jsonRequest(app, "/api/contacts/insights/repeat-viewers");
    expect(res.status).toBe(200);
    const d = res.body as { viewers: Array<{ id: string; postCount: number; touchCount: number }> };
    expect(d.viewers).toHaveLength(1);
    expect(d.viewers[0]).toMatchObject({ id: "c-r1", postCount: 2, touchCount: 2 });
    expect(JSON.stringify(d)).not.toContain("profile");
  });
});
