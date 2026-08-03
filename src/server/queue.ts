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
import type { ChannelAdapter } from "@/adapters/channels/types";
import { markVariantFailed } from "@/domain/post";
import {
  publishJobId,
  publishQueueName,
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
import { applyClick, type ClickEvent } from "./interactions";

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
  let schedulerQueue: Queue | null = null;

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
        jobs.map((job) => queueFor(job.name).add(job.name, job.data, job.opts)),
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

    async close() {
      await Promise.all([
        ...Array.from(publishQueues.values()).map((q) => q.close()),
        schedulerQueue?.close(),
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
      (job) => publishJobProcessor(deps, job),
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
        schedulerWorker.close(),
        clickWorker.close(),
        reconcilerWorker.close(),
      ]);
      await publisher.close();
      await connection.quit();
    },
  };
}
