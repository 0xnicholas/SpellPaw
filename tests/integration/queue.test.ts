// Real-queue integration tests: BullMQ + Redis + workers end-to-end.
// Requires the dockerized Redis (docker compose up -d). Fails loudly if absent.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import { createPrismaClient } from "@/lib/db";
import { encryptString } from "@/lib/crypto";
import { MockAdapter } from "@/adapters/channels/mock";
import type { ChannelAdapter } from "@/adapters/channels/types";
import {
  createPublisher,
  createWorkers,
  runScheduleReconciler,
  type RunningWorkers,
} from "@/server/queue";
import { publishJobId, publishQueueName, schedulerJobId } from "@/server/queue-domain";
import type { Publisher } from "@/server/publisher";
import { resetTestSchema, TEST_DATABASE_URL } from "./setup";

const ACCOUNT = "queue-test-account";
const KEY = Buffer.from("q".repeat(32), "utf8");
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const DAY = 86_400_000;

let prisma: ReturnType<typeof createPrismaClient>;
let publisher: Publisher;
let workers: RunningWorkers;

function mockAdapters(overrides: Partial<Record<string, ChannelAdapter>> = {}) {
  return {
    twitter: new MockAdapter("twitter"),
    linkedin: new MockAdapter("linkedin"),
    instagram: new MockAdapter("instagram"),
    ...overrides,
  };
}

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out waiting for condition");
}

async function createPost(channelSlug: string, content: string, status = "DRAFT") {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { accountId: ACCOUNT } });
  const channel = await prisma.channel.findUniqueOrThrow({ where: { slug: channelSlug } });
  return prisma.post.create({
    data: {
      workspaceId: workspace.id,
      status: status as "DRAFT" | "SCHEDULED" | "PUBLISHED",
      variants: { create: { channelId: channel.id, content, charCount: content.length } },
    },
    include: { variants: true },
  });
}

async function variantState(variantId: string) {
  const v = await prisma.postVariant.findUnique({ where: { id: variantId } });
  return v?.publishState;
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
  const workspace = await prisma.workspace.create({ data: { accountId: ACCOUNT, name: "Queue" } });
  for (const slug of ["twitter", "linkedin"]) {
    const channel = await prisma.channel.findUniqueOrThrow({ where: { slug } });
    await prisma.oAuthConnection.create({
      data: {
        workspaceId: workspace.id,
        channelId: channel.id,
        accessToken: encryptString(`token:${slug}`, KEY),
      },
    });
  }

  // Workers run the whole suite: linkedin/instagram succeed via mocks, twitter
  // always throws so retry/failure-isolation paths are deterministic.
  const adapters = mockAdapters({
    twitter: {
      slug: "twitter",
      buildAuthUrl: () => "https://example.com/auth",
      exchangeCode: async () => ({ accessToken: "x" }),
      publish: async () => {
        throw new Error("rate limited");
      },
    },
  });
  publisher = createPublisher({
    prisma,
    redisUrl: REDIS_URL,
    adapters,
    encryptionKey: KEY,
    jobOptions: { attempts: 3, backoffMs: 50 },
  });
  workers = createWorkers({
    prisma,
    redisUrl: REDIS_URL,
    adapters,
    encryptionKey: KEY,
    jobOptions: { attempts: 3, backoffMs: 50 },
  });
});

afterAll(async () => {
  await workers.close();
  await prisma.$disconnect();
});

describe("queue publish", () => {
  it("publishes a variant through the worker and settles the post", async () => {
    const post = await createPost("linkedin", "queued publish");
    await publisher.enqueuePublish(post.id, post.workspaceId, post.variants.map((v) => v.id));

    // settlePost runs right after the variant flips — wait for the post-level
    // status so we don't race the two writes.
    await waitFor(async () => {
      const p = await prisma.post.findUnique({ where: { id: post.id } });
      return p?.status === "PUBLISHED";
    });
    const updated = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(updated.status).toBe("PUBLISHED");
    expect(updated.publishedAt).toBeTruthy();
    expect(await variantState(post.variants[0].id)).toBe("PUBLISHED");
  });

  it("exhausts retries with backoff, then marks the variant FAILED (isolation)", async () => {
    const post = await createPost("twitter", "always fails");
    await publisher.enqueuePublish(post.id, post.workspaceId, post.variants.map((v) => v.id));

    await waitFor(async () => (await variantState(post.variants[0].id)) === "FAILED");
    const variant = await prisma.postVariant.findUniqueOrThrow({ where: { id: post.variants[0].id } });
    expect(variant.errorMessage).toContain("rate limited");

    // A sibling channel still publishes — one channel's failures don't block others.
    const sibling = await createPost("linkedin", "unaffected");
    await publisher.enqueuePublish(sibling.id, sibling.workspaceId, sibling.variants.map((v) => v.id));
    await waitFor(async () => (await variantState(sibling.variants[0].id)) === "PUBLISHED");
  });

  it("marks permanent failures (channel not connected) without retrying", async () => {
    const post = await createPost("instagram", "no connection");
    await publisher.enqueuePublish(post.id, post.workspaceId, post.variants.map((v) => v.id));

    await waitFor(async () => (await variantState(post.variants[0].id)) === "FAILED");
    const variant = await prisma.postVariant.findUniqueOrThrow({ where: { id: post.variants[0].id } });
    expect(variant.errorMessage).toContain("not connected");
  });
});

describe("scheduled publish", () => {
  it("fires a delayed scheduler job and publishes on time", async () => {
    const post = await createPost("linkedin", "fire me soon", "SCHEDULED");
    await publisher.schedule(post.id, post.workspaceId, new Date(Date.now() + 1200));

    await waitFor(async () => (await variantState(post.variants[0].id)) === "PUBLISHED");
  });

  it("keeps the delayed job idempotent across reschedules", async () => {
    const post = await createPost("linkedin", "reschedule me", "SCHEDULED");
    await publisher.schedule(post.id, post.workspaceId, new Date(Date.now() + 60_000));
    await publisher.schedule(post.id, post.workspaceId, new Date(Date.now() + 90_000));

    const scheduler = new Queue("schedule", { connection: { url: REDIS_URL } });
    try {
      const job = await scheduler.getJob(schedulerJobId(post.id));
      expect(job).not.toBeNull();
      const delay = job!.opts.delay ?? 0; // v6: delay lives on opts
      expect(delay).toBeGreaterThan(60_000);
      expect(delay).toBeLessThanOrEqual(90_000);
    } finally {
      await scheduler.close();
    }
  });

  it("cancelSchedule disarms the scheduler job and waiting publish jobs", async () => {
    const post = await createPost("linkedin", "cancel me", "SCHEDULED");
    await publisher.schedule(post.id, post.workspaceId, new Date(Date.now() + 60_000));
    // A waiting publish job for the same post (e.g. reconciler race) must go too.
    await publisher.enqueuePublish(post.id, post.workspaceId, post.variants.map((v) => v.id));

    await publisher.cancelSchedule(post.id, post.workspaceId);

    const scheduler = new Queue("schedule", { connection: { url: REDIS_URL } });
    const publishQueue = new Queue(publishQueueName("linkedin"), { connection: { url: REDIS_URL } });
    try {
      // Scheduler job must be gone entirely.
      // BullMQ v6 returns undefined for missing jobs.
      expect(await scheduler.getJob(schedulerJobId(post.id))).toBeFalsy();
      // The publish job may still sit in the completed/failed/active sets, but
      // must never be pending (waiting/delayed) after cancellation — nothing
      // left that would fire later. (An in-flight publish completes; it already
      // started before the cancel.)
      const publishJob = await publishQueue.getJob(publishJobId(post.variants[0].id));
      if (publishJob) {
        expect(["waiting", "delayed"]).not.toContain(await publishJob.getState());
      }
    } finally {
      await scheduler.close();
      await publishQueue.close();
    }
  });

  it("does not arm a delayed job beyond the 7-day cron horizon", async () => {
    const post = await createPost("linkedin", "cron horizon", "SCHEDULED");
    await publisher.schedule(post.id, post.workspaceId, new Date(Date.now() + 8 * DAY));

    const scheduler = new Queue("schedule", { connection: { url: REDIS_URL } });
    try {
      // BullMQ v6 returns undefined for missing jobs
      expect(await scheduler.getJob(schedulerJobId(post.id))).toBeFalsy();
    } finally {
      await scheduler.close();
    }
  });

  it("rescheduling from within the horizon to beyond it removes the stale delayed job", async () => {
    const post = await createPost("linkedin", "horizon crosser", "SCHEDULED");
    await publisher.schedule(post.id, post.workspaceId, new Date(Date.now() + 60_000));
    // Move beyond the 7-day horizon — the cron reconciler takes over, so the
    // delayed job must NOT still fire at the old time.
    await publisher.schedule(post.id, post.workspaceId, new Date(Date.now() + 8 * DAY));

    const scheduler = new Queue("schedule", { connection: { url: REDIS_URL } });
    try {
      expect(await scheduler.getJob(schedulerJobId(post.id))).toBeFalsy();
    } finally {
      await scheduler.close();
    }
  });
});

describe("reconciler", () => {
  it("picks up overdue SCHEDULED posts and publishes their variants", async () => {
    const post = await createPost("linkedin", "overdue", "SCHEDULED");
    await prisma.post.update({
      where: { id: post.id },
      data: { scheduledAt: new Date(Date.now() - 3600_000) },
    });

    const touched = await runScheduleReconciler({
      prisma,
      redisUrl: REDIS_URL,
      adapters: mockAdapters(),
      encryptionKey: KEY,
    });
    expect(touched).toBeGreaterThanOrEqual(1);

    await waitFor(async () => (await variantState(post.variants[0].id)) === "PUBLISHED");
  });

  it("skips posts that are no longer scheduled", async () => {
    const post = await createPost("linkedin", "not overdue");
    const touched = await runScheduleReconciler({
      prisma,
      redisUrl: REDIS_URL,
      adapters: mockAdapters(),
      encryptionKey: KEY,
    });
    const variant = await prisma.postVariant.findUniqueOrThrow({ where: { id: post.variants[0].id } });
    expect(variant.publishState).toBe("DRAFT");
    expect(touched).toBeGreaterThanOrEqual(0);
  });

  it("never re-enqueues permanently FAILED variants (terminal until user retries)", async () => {
    const post = await createPost("twitter", "already dead", "SCHEDULED");
    await prisma.post.update({
      where: { id: post.id },
      data: { scheduledAt: new Date(Date.now() - 3600_000) },
    });
    await prisma.postVariant.update({
      where: { id: post.variants[0].id },
      data: { publishState: "FAILED", errorMessage: "rate limited" },
    });

    await runScheduleReconciler({
      prisma,
      redisUrl: REDIS_URL,
      adapters: mockAdapters(),
      encryptionKey: KEY,
    });

    const variant = await prisma.postVariant.findUniqueOrThrow({ where: { id: post.variants[0].id } });
    expect(variant.publishState).toBe("FAILED");
    expect(variant.errorMessage).toBe("rate limited");
  });
});
