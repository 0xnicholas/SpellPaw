// M6 Inbox Phase 1 (ADR-0013) — inbound pipeline + lifecycle recompute rules.
// Requires the dockerized Postgres + Redis (docker compose up -d).
// NOTE: like queue.test.ts, do NOT run while a dev/prod server is up — its
// workers share the same Redis queues and will steal mock-comment jobs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db";
import { encryptString } from "@/lib/crypto";
import { MockAdapter } from "@/adapters/channels/mock";
import {
  createPublisher,
  createWorkers,
  type RunningWorkers,
} from "@/server/queue";
import { mockCommentExternalId, mockCommentJobId } from "@/server/queue-domain";
import type { Publisher } from "@/server/publisher";
import {
  manuallyActivateContact,
  recordInboundMessage,
} from "@/server/inbox";
import { applyClick } from "@/server/interactions";
import { resetTestSchema, TEST_DATABASE_URL } from "./setup";

const ACCOUNT = "inbox-test-account";
const KEY = Buffer.from("i".repeat(32), "utf8");
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let prisma: ReturnType<typeof createPrismaClient>;
let publisher: Publisher;
let workers: RunningWorkers;

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out waiting for condition");
}

async function workspaceId(): Promise<string> {
  return (await prisma.workspace.findFirstOrThrow({ where: { accountId: ACCOUNT } })).id;
}

async function createPost(channelSlug: string, content: string) {
  const ws = await workspaceId();
  const channel = await prisma.channel.findUniqueOrThrow({ where: { slug: channelSlug } });
  return prisma.post.create({
    data: {
      workspaceId: ws,
      variants: {
        create: { channelId: channel.id, content, charCount: content.length },
      },
    },
    include: { variants: true },
  });
}

async function touchContact(contactId: string, postId: string, variantId: string) {
  await applyClick(prisma, {
    workspaceId: await workspaceId(),
    contactId,
    postId,
    variantId,
    action: "CLICK",
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
  await prisma.workspace.create({ data: { accountId: ACCOUNT, name: "Inbox" } });
  const channel = await prisma.channel.findUniqueOrThrow({ where: { slug: "linkedin" } });
  await prisma.oAuthConnection.create({
    data: {
      workspaceId: await workspaceId(),
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
});

afterAll(async () => {
  await workers.close();
  await prisma.$disconnect();
});

describe("recordInboundMessage", () => {
  it("creates the contact + conversation and flips AUDIENCE → CORRESPONDENT + ENGAGED", async () => {
    const post = await createPost("linkedin", "inbound target post");
    const ws = await workspaceId();

    const result = await recordInboundMessage(prisma, {
      workspaceId: ws,
      channelSlug: "linkedin",
      content: "How does pricing work?",
      externalId: "ext:q1",
      postId: post.id,
      sender: { name: "Frank Lin", handle: "franklin" },
    });

    expect(result.created).toBe(true);
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: result.conversationId },
    });
    expect(conversation.direction).toBe("INBOUND");
    expect(conversation.content).toBe("How does pricing work?");
    expect(conversation.postId).toBe(post.id);
    expect(conversation.channelId).toBe((await prisma.channel.findUniqueOrThrow({ where: { slug: "linkedin" } })).id);

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: result.contactId } });
    expect(contact.type).toBe("CORRESPONDENT");
    expect(contact.stateLifecycleStage).toBe("ENGAGED"); // 1 conversation rule
    expect(contact.profileName).toBe("Frank Lin");
    expect(contact.profileSocialHandle).toBe("franklin");
    expect(contact.profileSourceChannel).toBe("linkedin");
  });

  it("is idempotent on externalId — replay returns the existing row", async () => {
    const ws = await workspaceId();
    const first = await recordInboundMessage(prisma, {
      workspaceId: ws,
      channelSlug: "twitter",
      content: "hello",
      externalId: "ext:dedupe",
    });
    const second = await recordInboundMessage(prisma, {
      workspaceId: ws,
      channelSlug: "twitter",
      content: "hello",
      externalId: "ext:dedupe",
    });

    expect(second.created).toBe(false);
    expect(second.conversationId).toBe(first.conversationId);
    expect(await prisma.conversation.count({ where: { externalId: "ext:dedupe" } })).toBe(1);
  });

  it("unknown channel fails loudly", async () => {
    await expect(
      recordInboundMessage(prisma, {
        workspaceId: await workspaceId(),
        channelSlug: "nope",
        content: "x",
        externalId: "ext:bad-channel",
      }),
    ).rejects.toThrow('unknown channel "nope"');
  });
});

describe("Engaged rule (M6: ≥3 touches OR ≥1 conversation in 30d)", () => {
  it("keeps a contact AWARE at 2 touches", async () => {
    const ws = await workspaceId();
    const post = await createPost("linkedin", "engage post");
    const variant = post.variants[0];
    const contact = await prisma.contact.create({ data: { workspaceId: ws } });

    for (let i = 0; i < 2; i++) {
      await touchContact(contact.id, post.id, variant.id);
    }
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.stateLifecycleStage).toBe("AWARE");
    expect(after.type).toBe("AUDIENCE");
  });

  it("promotes to ENGAGED at 3 touches (cumulative, same post)", async () => {
    const ws = await workspaceId();
    const post = await createPost("linkedin", "engage post 2");
    const variant = post.variants[0];
    const contact = await prisma.contact.create({ data: { workspaceId: ws } });

    for (let i = 0; i < 3; i++) {
      await touchContact(contact.id, post.id, variant.id);
    }
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.stateLifecycleStage).toBe("ENGAGED");
    // No conversation → still an audience member.
    expect(after.type).toBe("AUDIENCE");
  });
});

describe("manual activation", () => {
  it("sets ACTIVATED + records the timeline Event, and recompute preserves it", async () => {
    const ws = await workspaceId();
    const post = await createPost("linkedin", "activate post");
    const variant = post.variants[0];
    const contact = await prisma.contact.create({ data: { workspaceId: ws } });

    await manuallyActivateContact(prisma, ws, contact.id);
    let after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.stateLifecycleStage).toBe("ACTIVATED");
    expect(
      await prisma.event.count({ where: { contactId: contact.id, eventType: "MANUAL_ACTIVATION" } }),
    ).toBe(1);

    // A later touch recomputes — ACTIVATED must stay sticky.
    await touchContact(contact.id, post.id, variant.id);
    after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.stateLifecycleStage).toBe("ACTIVATED");
  });

  it("rejects contacts outside the workspace", async () => {
    const other = await prisma.workspace.create({ data: { accountId: "other-account", name: "Other" } });
    const contact = await prisma.contact.create({ data: { workspaceId: other.id } });
    await expect(
      manuallyActivateContact(prisma, await workspaceId(), contact.id),
    ).rejects.toThrow("contact not found in workspace");
  });
});

describe("mock comment pipeline (ADR-0013)", () => {
  it("publish → scheduled comment → inbound conversation via the worker", async () => {
    const post = await createPost("linkedin", "comment bait");
    const variant = post.variants[0];
    const ws = await workspaceId();

    // The publish processor would enqueue with a 30–90s delay; call the same
    // producer directly with zero delay to exercise the worker end-to-end.
    await publisher.enqueueMockComment(
      {
        workspaceId: ws,
        postId: post.id,
        variantId: variant.id,
        channelSlug: "linkedin",
      },
      0,
    );

    await waitFor(async () => {
      return (
        (await prisma.conversation.count({ where: { externalId: mockCommentExternalId(variant.id) } })) === 1
      );
    });

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { externalId: mockCommentExternalId(variant.id) },
    });
    expect(conversation.direction).toBe("INBOUND");
    expect(conversation.postId).toBe(post.id);
    expect(conversation.content.length).toBeGreaterThan(0);

    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: conversation.contactId },
    });
    expect(contact.type).toBe("CORRESPONDENT");
    expect(contact.stateLifecycleStage).toBe("ENGAGED");
    expect(contact.profileSocialHandle).not.toBeNull();

    // Job id dedupe: a second enqueue with the same variant must not duplicate.
    await publisher.enqueueMockComment(
      {
        workspaceId: ws,
        postId: post.id,
        variantId: variant.id,
        channelSlug: "linkedin",
      },
      0,
    );
    expect(mockCommentJobId(variant.id)).toBeDefined();
    expect(
      await prisma.conversation.count({ where: { externalId: mockCommentExternalId(variant.id) } }),
    ).toBe(1);
  });
});
