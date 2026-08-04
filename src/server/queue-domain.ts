// Pure queue rules (no Redis I/O) — delay math, job ids, queue names.
// Spec §5: ≤ 7 days → BullMQ delay; > 7 days → 5-min cron reconciler.

export const CRON_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

export function scheduleDelayMs(scheduledAt: Date, now: Date = new Date()): number {
  return Math.max(0, scheduledAt.getTime() - now.getTime());
}

/** True when the schedule is beyond BullMQ's delayed-job horizon. */
export function shouldUseCron(scheduledAt: Date, now: Date = new Date()): boolean {
  return scheduleDelayMs(scheduledAt, now) > CRON_HORIZON_MS;
}

/** Idempotent per-variant publish job (rescheduling replaces, never duplicates).
 * BullMQ v6 forbids ":" in custom ids — use a dash separator. */
export function publishJobId(variantId: string): string {
  return `publish-${variantId}`;
}

/** Idempotent per-post scheduler job. */
export function schedulerJobId(postId: string): string {
  return `schedule-${postId}`;
}

/** One publish queue per channel slug — isolated workers, no cross-channel blocking. */
export function publishQueueName(channelSlug: string): string {
  return `publish-${channelSlug}`;
}

// --- M6 mock-first inbound (ADR-0013) --------------------------------------

/** Simulated-comment jobs land on their own queue; one worker handles all. */
export const MOCK_INBOUND_QUEUE = "mock-inbound";

/** Min/max delay between a successful publish and its simulated comment. */
export const MOCK_COMMENT_DELAY_MIN_MS = 30_000;
export const MOCK_COMMENT_DELAY_RANGE_MS = 60_000;

export interface MockCommentJobData {
  workspaceId: string;
  postId: string;
  variantId: string;
  channelSlug: string;
}

/** One simulated comment per variant ever (BullMQ id dedupe + Conversation.externalId). */
export function mockCommentJobId(variantId: string): string {
  return `mock-comment-${variantId}`;
}

/** Random delay in [30s, 90s) — the "someone replies shortly after posting" feel. */
export function mockCommentDelayMs(now: number = Date.now()): number {
  const seed = now % MOCK_COMMENT_DELAY_RANGE_MS;
  return MOCK_COMMENT_DELAY_MIN_MS + seed;
}

/** Platform message id for the simulated comment (unique per variant). */
export function mockCommentExternalId(variantId: string): string {
  return `mock:comment:${variantId}`;
}

// --- M6 outbound replies (ADR-0013) ----------------------------------------

/** One reply queue per channel slug — same isolation rationale as publish. */
export function replyQueueName(channelSlug: string): string {
  return `reply-${channelSlug}`;
}

/** One reply job per outbound Conversation row (idempotent, never duplicates). */
export function replyJobId(conversationId: string): string {
  return `reply-${conversationId}`;
}

export interface ReplyJobData {
  conversationId: string;
  workspaceId: string;
  channelSlug: string;
  content: string;
  /** Platform id of the message being replied to (the latest inbound row). */
  replyToExternalId: string;
  /** Platform id of the originating post when replying to a comment chain. */
  postExternalId?: string | null;
}
