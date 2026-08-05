// M7-C Persona derivation tests. buildPersonaPrompt is a pure unit; the
// derive outcomes are integration tests against Postgres with an injected fake
// completer (no real LLM call). Prior art: tests/integration/graph.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db";
import type { PrismaClient } from "@/generated/prisma/client";
import { buildPersonaPrompt, derivePersonaForContact, runPersonaBatch } from "@/server/persona";
import { encryptString } from "@/lib/crypto";
import { resetTestSchema, TEST_DATABASE_URL } from "./setup";

const ACCOUNT = "m7c-account";
const WS = `ws-m7c-${ACCOUNT}`;
const ENC = Buffer.from("b".repeat(32));

let prisma: PrismaClient;
let variantId: string;

// Deterministic fake derivation (replaces the real complete()).
const FAKE_JSON = JSON.stringify({
  contentDNA: { topics: [{ label: "dev tools", weight: 0.8 }], channelAffinity: { twitter: 0.9 }, toneAffinity: ["technical"] },
  sentimentArc: { points: [{ ts: "2026-08-01", score: -0.2, label: "curious" }], trend: "stable", currentScore: -0.1 },
  intent: { category: "buy", confidence: 0.7, evidence: ["asked pricing"] },
});
const fakeCompleter = async () => FAKE_JSON;
const throwingCompleter = async () => {
  throw new Error("provider down");
};

beforeAll(async () => {
  resetTestSchema();
  prisma = createPrismaClient(TEST_DATABASE_URL!);
  await prisma.workspace.create({ data: { id: WS, accountId: ACCOUNT, name: "M7C" } });
  const channel = await prisma.channel.upsert({
    where: { slug: "twitter" },
    update: {},
    create: { slug: "twitter", name: "Twitter / X" },
  });
  const post = await prisma.post.create({
    data: {
      workspaceId: WS,
      title: "P",
      status: "PUBLISHED",
      publishedAt: new Date(),
      variants: { create: { channelId: channel.id, content: "ship fast", publishState: "PUBLISHED" } },
    },
    include: { variants: true },
  });
  variantId = post.variants[0]!.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.conversation.deleteMany({ where: { workspaceId: WS } });
  await prisma.event.deleteMany({ where: { workspaceId: WS } });
  await prisma.contentTouch.deleteMany({ where: { post: { workspaceId: WS } } });
  await prisma.contact.deleteMany({ where: { workspaceId: WS } });
  await prisma.modelProviderKey.deleteMany({ where: { workspaceId: WS } });
  await prisma.workspace.update({ where: { id: WS }, data: { personaDerivationEnabled: true } });
});

async function seedDirtyContact(id: string) {
  // A Content Touch sets personaDirtyAt via the recompute path; create directly
  // to control the dirty flag without pulling in the click pipeline.
  await prisma.contact.create({ data: { id, workspaceId: WS, personaDirtyAt: new Date() } });
  await prisma.contentTouch.create({
    data: { contactId: id, postId: (await prisma.post.findFirstOrThrow({ where: { workspaceId: WS } })).id, variantId, action: "CLICK" },
  });
}

describe("buildPersonaPrompt (pure)", () => {
  it("includes engaged posts and conversations, truncated", () => {
    const { system, user } = buildPersonaPrompt(
      [{ content: "x".repeat(400), action: "LIKE", channel: "twitter" }],
      [{ content: "hello", direction: "INBOUND", timestamp: new Date("2026-08-01") }],
    );
    expect(system).toMatch(/JSON object/);
    expect(user).toMatch(/ENGAGED POSTS/);
    expect(user).toMatch(/\[LIKE @twitter\]/);
    expect(user).toMatch(/CONVERSATIONS/);
    expect(user).toMatch(/\(INBOUND/);
    expect(user).toMatch(/hello/);
    // 400-char content truncated to 280.
    expect(user).not.toContain("x".repeat(400));
  });
});

describe("derivePersonaForContact — gate + degradation", () => {
  it("gate OFF → skipped, dirty retained, no egress", async () => {
    await prisma.workspace.update({ where: { id: WS }, data: { personaDerivationEnabled: false } });
    await seedDirtyContact("g1");
    const outcome = await derivePersonaForContact(prisma, "g1", ENC, fakeCompleter);
    expect(outcome).toBe("gate-off");
    const c = await prisma.contact.findUniqueOrThrow({ where: { id: "g1" } });
    expect(c.personaDirtyAt).not.toBeNull(); // left dirty
    expect(c.personaIntent).toBeNull();
  });

  it("gate ON + no BYOK key → rule fallback, dirty cleared", async () => {
    await seedDirtyContact("k1");
    const outcome = await derivePersonaForContact(prisma, "k1", ENC, fakeCompleter);
    expect(outcome).toBe("no-key");
    const c = await prisma.contact.findUniqueOrThrow({ where: { id: "k1" } });
    expect(c.personaDirtyAt).toBeNull();
    expect(c.personaIntent).toMatchObject({ category: "dormant" });
  });

  it("gate ON + key → derives three facets, dirty cleared", async () => {
    await seedDirtyContact("d1");
    await prisma.modelProviderKey.create({
      data: { workspaceId: WS, provider: "openai", encryptedKey: encryptString("sk-test", ENC), keyPreview: "sk-…test", isActive: true },
    });
    const outcome = await derivePersonaForContact(prisma, "d1", ENC, fakeCompleter);
    expect(outcome).toBe("derived");
    const c = await prisma.contact.findUniqueOrThrow({ where: { id: "d1" } });
    expect(c.personaDirtyAt).toBeNull();
    expect(c.personaContentDNA).toMatchObject({ channelAffinity: { twitter: 0.9 } });
    expect(c.personaSentimentArc).toMatchObject({ trend: "stable" });
    expect(c.personaIntent).toMatchObject({ category: "buy", confidence: 0.7 });
  });

  it("AI failure → keeps prior Persona, dirty retained (retried next cron)", async () => {
    await seedDirtyContact("f1");
    await prisma.modelProviderKey.create({
      data: { workspaceId: WS, provider: "openai", encryptedKey: encryptString("sk-test", ENC), keyPreview: "sk-…test", isActive: true },
    });
    const outcome = await derivePersonaForContact(prisma, "f1", ENC, throwingCompleter);
    expect(outcome).toBe("failed");
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: "f1" } })).personaDirtyAt).not.toBeNull();
  });

  it("no interactions in window → clears dirty, derives nothing", async () => {
    await prisma.contact.create({ data: { id: "n1", workspaceId: WS, personaDirtyAt: new Date() } });
    const outcome = await derivePersonaForContact(prisma, "n1", ENC, fakeCompleter);
    expect(outcome).toBe("no-content");
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: "n1" } })).personaDirtyAt).toBeNull();
  });
});

describe("runPersonaBatch", () => {
  it("scans dirty Contacts, derives them, and a second pass finds none (idempotent)", async () => {
    await prisma.modelProviderKey.create({
      data: { workspaceId: WS, provider: "openai", encryptedKey: encryptString("sk-test", ENC), keyPreview: "sk-…test", isActive: true },
    });
    await seedDirtyContact("b1");
    await seedDirtyContact("b2");
    const res1 = await runPersonaBatch({ prisma, encryptionKey: ENC }, fakeCompleter);
    expect(res1.scanned).toBe(2);
    expect(res1.results.derived).toBe(2);
    // dirty flags cleared → the next pass scans nothing.
    const res2 = await runPersonaBatch({ prisma, encryptionKey: ENC }, fakeCompleter);
    expect(res2.scanned).toBe(0);
  });
});
