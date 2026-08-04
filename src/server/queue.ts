// BullMQ implementation of the Publisher seam (M2 — spec §5 async flows).
// One publish queue per channel slug → isolated workers; a shared scheduler
// queue with delayed jobs (≤7d) + a 5-min cron reconciler (>7d safety net).
//
// Documented deviation from spec §5: per-channel publish queues
// (`publish-<slug>`) instead of a single shared publishQueue — BullMQ v6 has no
// per-channel job routing, and separate queues give real isolation without
// cross-worker misrouting. Retry ladder: 3 retries, exponential 30s base
// (30s/60s/120s — an approximation of the spec's 30s/2m/8m, which BullMQ
// cannot express exactly).
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import type { PrismaClient } from "@/generated/prisma/client";
import { markVariantFailed } from "@/domain/post";
import {
  MOCK_INBOUND_QUEUE,
  mockCommentDelayMs,
  mockCommentExternalId,
  mockCommentJobId,
  type MockCommentJobData,
  publishJobId,
  publishQueueName,
  replyJobId,
  replyQueueName,
  type ReplyJobData,
  schedulerJobId,
  scheduleDelayMs,
  shouldUseCron,
} from "./queue-domain";
import type { Publisher } from "./publisher";
import {
  PermanentPublishError,
  publishVariantToChannel,
  settlePost,
} from "./posts";
import type { Post, PostVariant } from "@/generated/prisma/client";
import type { ChannelAdapter, TokenSet } from "@/adapters/channels/types";
import { decryptString, encryptString } from "@/lib/crypto";
import { applyClick, type ClickEvent } from "./interactions";
import { recordInboundMessage } from "./inbox";
import { generateMockComment } from "@/adapters/channels/mock";

export interface QueueJobOptions {
  attempts?: number;
  backoffMs?: number;
}

export interface QueueDeps {
  prisma: PrismaClient;
  redisUrl: string;
  adapters: Record<string, ChannelAdapter>;
  encryptionKey: Buffer;
  jobOptions?: QueueJobOptions;
}

export interface PublishJobData {
  postId: string;
  workspaceId: string;
  channelSlug: string;
  variantId: string;
}

export interface ScheduleJobData {
  postId: string;
  workspaceId: string;
}

const SCHEDULER_QUEUE = "schedule";
const RECONCILER_JOB = "run-reconciler";
const RECONCILER_EVERY_MS = 5 * 60 * 1000;
// Short-link click attribution (ADR-0009): fire-and-forget from the redirect,
// 3 attempts (1 initial + 2 retries, exponential backoff from 5s) so no click
// is silently lost. ADR says "3 retries" — attempts semantics chosen for
// consistency with the publish queue (attempts = total tries).
const CLICK_QUEUE = "click-touch";
const CLICK_ATTEMPTS = 3;

function redis(url: string): IORedis {
  return new IORedis(url, { maxRetriesPerRequest: null });
}

export function createPublisher(deps: QueueDeps): Publisher {
  const { prisma } = deps;
  // attempts = 4 → one initial run + 3 retries (spec: "3 retries with backoff").
  const options = deps.jobOptions ?? { attempts: 4, backoffMs: 30_000 };
  const publishQueues = new Map<string, Queue>();
  const replyQueues = new Map<string, Queue>();
  let schedulerQueue: Queue | null = null;
  let mockInboundQueue: Queue | null = null;

  function queueFor(slug: string): Queue {
    const existing = publishQueues.get(slug);
    if (existing) return existing;
    const queue = new Queue(publishQueueName(slug), { connection: redis(deps.redisUrl) });
    publishQueues.set(slug, queue);
    return queue;
  }

  function scheduler(): Queue {
    schedulerQueue ??= new Queue(SCHEDULER_QUEUE, { connection: redis(deps.redisUrl) });
    return schedulerQueue;
  }

  function mockInbound(): Queue {
    mockInboundQueue ??= new Queue(MOCK_INBOUND_QUEUE, {
      connection: redis(deps.redisUrl),
    });
    return mockInboundQueue;
  }

  function replyQueueFor(slug: string): Queue {
    const existing = replyQueues.get(slug);
    if (existing) return existing;
    const queue = new Queue(replyQueueName(slug), {
      connection: redis(deps.redisUrl),
    });
    replyQueues.set(slug, queue);
    return queue;
  }

  return {
    async enqueuePublish(postId, workspaceId, variantIds) {
      const variants = await prisma.postVariant.findMany({
        where: { id: { in: variantIds } },
        include: { channel: true },
      });
      const jobs = variants.map((v) => ({
        name: v.channel.slug,
        data: {
          postId,
          workspaceId,
          channelSlug: v.channel.slug,
          variantId: v.id,
        } satisfies PublishJobData,
        opts: {
          jobId: publishJobId(v.id),
          attempts: options.attempts,
          backoff: { type: "exponential" as const, delay: options.backoffMs },
          removeOnComplete: { age: 3600, count: 100 },
          removeOnFail: { age: 86_400 },
        },
      }));
      await Promise.all(
        jobs.map((job) => {
          const q = queueFor(job.name);
          // BullMQ v6 silently ignores add() with a jobId that already exists
          // (any state). Retrying a FAILED variant must re-enqueue, so drop the
          // old job record first — matches the schedule() "drop-then-add" rule.
          return q
            .remove(job.opts.jobId as string)
            .then(() => q.add(job.name, job.data, job.opts));
        }),
      );
      return { queued: jobs.length };
    },

    async schedule(postId, workspaceId, scheduledAt) {
      // Always drop any previously-armed delayed job first — both so reschedules
      // genuinely move the firing time (v6 `add` won't update an existing
      // delayed job's delay) and so moving a schedule across the 7-day horizon
      // doesn't leave a stale job that fires early. Beyond the horizon the cron
      // reconciler is the sole executor.
      await scheduler().remove(schedulerJobId(postId));
      if (shouldUseCron(scheduledAt)) return;
      await scheduler().add(
        "publish-scheduled-post",
        { postId, workspaceId } satisfies ScheduleJobData,
        {
          jobId: schedulerJobId(postId),
          delay: scheduleDelayMs(scheduledAt),
          removeOnComplete: true,
          removeOnFail: { age: 86_400 },
        },
      );
    },

    async cancelSchedule(postId, workspaceId) {
      await scheduler().remove(schedulerJobId(postId));
      // Also drop waiting/delayed publish jobs for this post's variants.
      const variants = await prisma.postVariant.findMany({
        where: { post: { id: postId, workspaceId } },
        include: { channel: true },
      });
      for (const variant of variants) {
        const queue = queueFor(variant.channel.slug);
        const job = await queue.getJob(publishJobId(variant.id));
        if (!job) continue;
        const state = await job.getState();
        if (state === "waiting" || state === "delayed") {
          await job.remove();
        }
      }
    },

    async getVariantQueueState(variantId) {
      const variant = await prisma.postVariant.findUnique({
        where: { id: variantId },
        include: { channel: true },
      });
      if (!variant) return null;
      const job = await queueFor(variant.channel.slug).getJob(publishJobId(variantId));
      if (!job) return null;
      const state = await job.getState();
      if (state === "waiting") return "queued";
      if (state === "active") return "posting";
      if (state === "delayed") return "scheduled";
      return null;
    },

    async enqueueMockComment(input: MockCommentJobData, delayMs = mockCommentDelayMs()) {
      // One simulated comment per variant ever: the job id dedupes, and the
      // inbound row's externalId dedupes again (ADR-0013).
      await mockInbound().add(MOCK_INBOUND_QUEUE, input, {
        jobId: mockCommentJobId(input.variantId),
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: { age: 86_400 },
      });
    },

    async enqueueReply(input: ReplyJobData) {
      // One reply per OUTBOUND row: the job id dedupes on the conversation id.
      // attempts = 2 → one initial run + ONE transient retry (ADR-0013:
      // replies never auto-retry more than once — a duplicate reply is worse
      // than a failed one the user can resend).
      await replyQueueFor(input.channelSlug).add(replyQueueName(input.channelSlug), input, {
        jobId: replyJobId(input.conversationId),
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: { age: 86_400 },
      });
    },

    async close() {
      await Promise.all([
        ...Array.from(publishQueues.values()).map((q) => q.close()),
        ...Array.from(replyQueues.values()).map((q) => q.close()),
        schedulerQueue?.close(),
        mockInboundQueue?.close(),
      ]);
    },
  };
}

// --- Workers ---------------------------------------------------------------

export interface WorkerDeps extends QueueDeps {
  /** Worker concurrency (default 5). */
  concurrency?: number;
}

/** Variants the auto-pipeline (scheduler job / reconciler) may push. */
function autoPublishableVariantIds(post: Post & { variants: PostVariant[] }): string[] {
  return post.variants
    .filter((v) => v.publishState === "DRAFT" && v.content.trim().length > 0)
    .map((v) => v.id);
}

async function publishJobProcessor(
  deps: WorkerDeps,
  publisher: Publisher,
  job: Job<PublishJobData>,
): Promise<void> {
  const { prisma } = deps;
  const variant = await prisma.postVariant.findUnique({
    where: { id: job.data.variantId },
    include: { channel: true },
  });
  // Post/variant deleted while queued — nothing to publish.
  if (!variant) return;
  if (variant.publishState === "PUBLISHED") return;

  try {
    const outcome = await publishVariantToChannel(
      prisma,
      deps.adapters,
      deps.encryptionKey,
      variant,
      job.data.workspaceId,
    );
    if (outcome.state === "failed") {
      // Transient platform error — rethrow so BullMQ retries with backoff.
      throw new Error(outcome.message);
    }
    // Mock-first inbound (ADR-0013): a simulated comment arrives 30–90s after
    // a successful publish. Scheduling failures are cosmetic — never fail the
    // already-succeeded publish job over a demo comment.
    if (deps.adapters[job.data.channelSlug]?.simulatesInbound) {
      try {
        await publisher.enqueueMockComment({
          workspaceId: job.data.workspaceId,
          postId: job.data.postId,
          variantId: job.data.variantId,
          channelSlug: job.data.channelSlug,
        });
      } catch (err) {
        console.error("[queue] failed to schedule mock comment", err);
      }
    }
    await settlePost(prisma, job.data.postId);
  } catch (err) {
    // Permanent failures were already marked FAILED in the DB — complete the
    // job without retry. Everything else propagates to the retry machinery.
    if (err instanceof PermanentPublishError) return;
    throw err;
  }
}

async function schedulerJobProcessor(
  deps: WorkerDeps,
  publisher: Publisher,
  job: Job<ScheduleJobData>,
): Promise<void> {
  const { prisma } = deps;
  const post = await prisma.post.findUnique({
    where: { id: job.data.postId },
    include: { variants: true },
  });
  if (!post || post.status !== "SCHEDULED") return; // cancelled/edited meanwhile
  const ready = autoPublishableVariantIds(post);
  if (ready.length === 0) return;
  await publisher.enqueuePublish(post.id, job.data.workspaceId, ready);
}

async function reconcilerJobProcessor(
  deps: WorkerDeps,
  publisher: Publisher,
): Promise<void> {
  await runScheduleReconciler(deps, publisher);
}

/**
 * 5-min cron safety net (spec §5): picks up SCHEDULED posts whose time has
 * come — covers >7d schedules and any delayed job that never fired.
 * Only DRAFT variants are auto-pushed: FAILED variants are terminal until the
 * user explicitly retries (spec §8), so they never get re-enqueued here.
 */
export async function runScheduleReconciler(
  deps: QueueDeps,
  publisher?: Publisher,
): Promise<number> {
  const pub = publisher ?? createPublisher(deps);
  const now = new Date();
  const overdue = await deps.prisma.post.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    include: { variants: true },
  });
  for (const post of overdue) {
    const ready = autoPublishableVariantIds(post);
    if (ready.length > 0) {
      await pub.enqueuePublish(post.id, post.workspaceId, ready);
    }
  }
  return overdue.length;
}

export interface RunningWorkers {
  close: () => Promise<void>;
}

/** Producer handle for the click-attribution queue (fire-and-forget). */
export function clickQueue(redisUrl: string): Queue<ClickEvent> {
  return new Queue(CLICK_QUEUE, {
    connection: redis(redisUrl),
    defaultJobOptions: {
      attempts: CLICK_ATTEMPTS,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    },
  });
}

/**
 * Simulated-comment job (ADR-0013 mock-first inbound): generates a comment
 * and funnels it through recordInboundMessage — the same path a real channel
 * fetchInbound poll will use. Idempotent by Conversation.externalId.
 */
async function mockCommentProcessor(
  deps: WorkerDeps,
  job: Job<MockCommentJobData>,
): Promise<void> {
  const { workspaceId, postId, variantId, channelSlug } = job.data;
  const comment = generateMockComment(variantId);
  await recordInboundMessage(deps.prisma, {
    workspaceId,
    channelSlug,
    content: comment.content,
    externalId: mockCommentExternalId(variantId),
    postId,
    sender: { name: comment.name, handle: comment.handle },
  });
}

/** Refresh only when we know the token expires and it is stale (5 min margin). */
function needsRefresh(tokens: TokenSet): boolean {
  if (!tokens.expiresAt) return false;
  return tokens.expiresAt.getTime() <= Date.now() + 5 * 60 * 1000;
}

/**
 * Reply job (ADR-0013): executes the platform call for one OUTBOUND row and
 * flips it PENDING → SENT. Permanent problems (no connection, no reply
 * support, dead refresh grant) mark FAILED and complete without retry;
 * platform errors rethrow for the ONE transient retry, and the worker's
 * failed handler marks FAILED after attempts are exhausted.
 */
async function replyJobProcessor(
  deps: WorkerDeps,
  job: Job<ReplyJobData>,
): Promise<void> {
  const { prisma } = deps;
  const conversation = await prisma.conversation.findUnique({
    where: { id: job.data.conversationId },
  });
  // Deleted or already terminal (SENT, or FAILED by the retry handler).
  if (!conversation || conversation.deliveryState !== "PENDING") return;

  const connection = await prisma.oAuthConnection.findUnique({
    where: {
      workspaceId_channelId: {
        workspaceId: job.data.workspaceId,
        channelId: conversation.channelId,
      },
    },
  });
  if (!connection) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { deliveryState: "FAILED", errorMessage: "channel not connected" },
    });
    return;
  }
  const adapter = deps.adapters[job.data.channelSlug];
  if (!adapter?.reply) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        deliveryState: "FAILED",
        errorMessage: `channel ${job.data.channelSlug} does not support replies`,
      },
    });
    return;
  }

  try {
    let tokens: TokenSet = {
      accessToken: decryptString(connection.accessToken, deps.encryptionKey),
      refreshToken: connection.refreshToken
        ? decryptString(connection.refreshToken, deps.encryptionKey)
        : null,
      expiresAt: connection.expiresAt,
    };
    // Same silent-refresh dance as publish (X rotates every 2h). A dead grant
    // is permanent — a reply can never succeed, so mark FAILED and stop.
    if (adapter.refresh && needsRefresh(tokens)) {
      let rotated: TokenSet;
      try {
        rotated = await adapter.refresh(tokens);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            deliveryState: "FAILED",
            errorMessage: `token refresh failed: ${message} — reconnect the channel in Settings`,
          },
        });
        return;
      }
      await prisma.oAuthConnection.update({
        where: { id: connection.id },
        data: {
          accessToken: encryptString(rotated.accessToken, deps.encryptionKey),
          refreshToken: rotated.refreshToken
            ? encryptString(rotated.refreshToken, deps.encryptionKey)
            : null,
          expiresAt: rotated.expiresAt ?? null,
        },
      });
      tokens = rotated;
    }

    await adapter.reply(
      { externalId: job.data.replyToExternalId, postExternalId: job.data.postExternalId },
      job.data.content,
      tokens,
    );
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { deliveryState: "SENT", errorMessage: null },
    });
  } catch (err) {
    // Platform error — transient by default: rethrow for the single retry.
    throw err;
  }
}

export function createWorkers(deps: WorkerDeps): RunningWorkers {
  const connection = redis(deps.redisUrl);
  const publisher = createPublisher(deps);

  const publishWorkers = Object.keys(deps.adapters).map((slug) => {
    // Per-channel queue, concurrency 1: publishes for one channel serialize, so
    // two same-channel jobs can never refresh the same token concurrently
    // (X rotates refresh tokens — a concurrent second refresh would die with
    // invalid_grant and spuriously FAIL a healthy variant).
    const worker = new Worker<PublishJobData>(
      publishQueueName(slug),
      (job) => publishJobProcessor(deps, publisher, job),
      { connection, concurrency: 1 },
    );
    // Transient failure exhausted all attempts → persist FAILED.
    worker.on("failed", async (job, err) => {
      if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
      const variant = await deps.prisma.postVariant.findUnique({
        where: { id: job.data.variantId },
      });
      if (!variant || variant.publishState === "PUBLISHED") return;
      await deps.prisma.postVariant.update({
        where: { id: job.data.variantId },
        data: markVariantFailed(err.message),
      });
    });
    return worker;
  });

  const schedulerWorker = new Worker<ScheduleJobData>(
    SCHEDULER_QUEUE,
    (job) => schedulerJobProcessor(deps, publisher, job),
    { connection, concurrency: 2 },
  );

  // Click attribution (ADR-0009): redirects enqueue fire-and-forget; the
  // worker owns contact resolution + touch insert + state recompute.
  const clickWorker = new Worker<ClickEvent>(
    CLICK_QUEUE,
    (job) => applyClick(deps.prisma, job.data),
    { connection, concurrency: 10 },
  );

  // Mock-first inbound (ADR-0013): simulated comments after publish.
  const mockInboundWorker = new Worker<MockCommentJobData>(
    MOCK_INBOUND_QUEUE,
    (job) => mockCommentProcessor(deps, job),
    { connection, concurrency: 2 },
  );

  // Outbound replies (ADR-0013): per-channel queues, concurrency 1 — same
  // token-refresh serialization rationale as the publish workers.
  const replyWorkers = Object.keys(deps.adapters).map((slug) => {
    const worker = new Worker<ReplyJobData>(
      replyQueueName(slug),
      (job) => replyJobProcessor(deps, job),
      { connection, concurrency: 1 },
    );
    worker.on("failed", async (job, err) => {
      if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
      const conversation = await deps.prisma.conversation.findUnique({
        where: { id: job.data.conversationId },
      });
      if (!conversation || conversation.deliveryState !== "PENDING") return;
      await deps.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          deliveryState: "FAILED",
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    });
    return worker;
  });

  const reconcilerWorker = new Worker(RECONCILER_JOB, () =>
    reconcilerJobProcessor(deps, publisher),
  { connection, concurrency: 1 });

  // Register the 5-min cron via a BullMQ v6 job scheduler (idempotent across
  // processes — same scheduler id dedupes).
  void (async () => {
    const queue = new Queue(RECONCILER_JOB, { connection: redis(deps.redisUrl) });
    try {
      await queue.upsertJobScheduler(
        RECONCILER_JOB,
        { every: RECONCILER_EVERY_MS },
        { name: RECONCILER_JOB, data: {} },
      );
    } catch (err) {
      console.error("[queue] failed to register reconciler cron", err);
    } finally {
      await queue.close();
    }
  })();

  return {
    async close() {
      await Promise.all([
        ...publishWorkers.map((w) => w.close()),
        ...replyWorkers.map((w) => w.close()),
        schedulerWorker.close(),
        clickWorker.close(),
        mockInboundWorker.close(),
        reconcilerWorker.close(),
      ]);
      await publisher.close();
      await connection.quit();
    },
  };
}
