// Publisher seam — the API/services talk to this interface; the BullMQ
// implementation (./queue) is swappable for tests (sync fake).
import type { PrismaClient } from "@/generated/prisma/client";
import type { MockCommentJobData } from "./queue-domain";

/** Non-terminal job state surfaced to the UI; terminal states come from the DB. */
export type QueueJobState = "queued" | "posting" | "scheduled";

export interface Publisher {
  /** Enqueue publish jobs for the given (non-published) variant ids. */
  enqueuePublish(postId: string, workspaceId: string, variantIds: string[]): Promise<{ queued: number }>;
  /** Arm (or re-arm, idempotently) the scheduler job for a post. */
  schedule(postId: string, workspaceId: string, scheduledAt: Date): Promise<void>;
  /** Disarm the scheduler job + any waiting publish jobs for the post. */
  cancelSchedule(postId: string, workspaceId: string): Promise<void>;
  /** Live job state per variant (null when terminal/none). */
  getVariantQueueState(variantId: string): Promise<QueueJobState | null>;
  /**
   * M6 mock-first inbound (ADR-0013): schedule a simulated comment for a
   * successfully published variant. No-op for real adapters (they never call
   * it — the publish processor gates on adapter.simulatesInbound).
   */
  enqueueMockComment(
    input: MockCommentJobData,
    delayMs?: number,
  ): Promise<void>;
  /** Release cached queue connections. */
  close(): Promise<void>;
}

export type { PrismaClient };
