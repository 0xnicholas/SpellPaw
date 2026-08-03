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
