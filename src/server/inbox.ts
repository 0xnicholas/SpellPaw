// Inbox domain service (M6 — ADR-0013 "row-as-message").
// The single inbound path: any source of incoming messages (the mock-comment
// queue job today, a real channel fetchInbound poll later) funnels through
// recordInboundMessage, so dedup, contact resolution and lifecycle recompute
// live in exactly one place. Outbound replies go through sendReply (row
// created PENDING, queue job executes the platform call).
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { ApiError } from "./errors";
import type { Publisher } from "./publisher";
import { replyJobId } from "./queue-domain";
import { recomputeContactState, type TxClient } from "./interactions";

export interface InboundMessageInput {
  workspaceId: string;
  /** Platform channel slug — resolved to channelId here. */
  channelSlug: string;
  content: string;
  /** Platform-side message id — unique, drives idempotent dedup. */
  externalId: string;
  /** Post this message replies to (comment pipeline). */
  postId?: string | null;
  /** Display identity for a freshly created contact (mock inbound). */
  sender?: { name?: string; handle?: string };
}

export interface InboundMessageResult {
  conversationId: string;
  contactId: string;
  /** true when a new row was written; false when the externalId already existed. */
  created: boolean;
}

/**
 * Record one inbound message: resolve/create the contact, insert the
 * Conversation row (deduped by externalId), then recompute lifecycle state —
 * all in one transaction. Idempotent: replaying the same externalId returns
 * the existing row without side effects.
 */
export async function recordInboundMessage(
  prisma: PrismaClient,
  input: InboundMessageInput,
): Promise<InboundMessageResult> {
  const existing = await prisma.conversation.findUnique({
    where: { externalId: input.externalId },
    select: { id: true, contactId: true },
  });
  if (existing) {
    return { conversationId: existing.id, contactId: existing.contactId, created: false };
  }

  const channel = await prisma.channel.findUnique({
    where: { slug: input.channelSlug },
  });
  if (!channel) throw new Error(`unknown channel "${input.channelSlug}"`);

  return prisma.$transaction(async (tx) => {
    const contact = await tx.contact.create({
      data: {
        workspaceId: input.workspaceId,
        // Defaults to AUDIENCE; recompute below flips to CORRESPONDENT.
        profileName: input.sender?.name ?? null,
        profileSocialHandle: input.sender?.handle ?? null,
        profileSourceChannel: channel.slug,
      },
    });
    const conversation = await tx.conversation.create({
      data: {
        workspaceId: input.workspaceId,
        contactId: contact.id,
        channelId: channel.id,
        postId: input.postId ?? null,
        content: input.content,
        externalId: input.externalId,
        direction: "INBOUND",
      },
    });
    await recomputeContactState(tx, contact.id);
    return { conversationId: conversation.id, contactId: contact.id, created: true };
  });
}

/**
 * Manual activation (M6): the user marks a Contact as having product-usage
 * evidence. Records an Event (visible on the timeline) and sets the lifecycle
 * stage to ACTIVATED — sticky, recompute never downgrades it.
 */
export async function manuallyActivateContact(
  prisma: PrismaClient,
  workspaceId: string,
  contactId: string,
): Promise<void> {
  await prisma.$transaction(async (tx: TxClient) => {
    const contact = await tx.contact.findFirst({
      where: { id: contactId, workspaceId },
      select: { id: true, stateLifecycleStage: true },
    });
    if (!contact) throw new Error("contact not found in workspace");
    await tx.event.create({
      data: {
        workspaceId,
        contactId,
        eventType: "MANUAL_ACTIVATION",
      },
    });
    await tx.contact.update({
      where: { id: contactId },
      data: { stateLifecycleStage: "ACTIVATED" },
    });
  });
}

// --- Outbound replies (M6) -------------------------------------------------

export interface ReplyInput {
  workspaceId: string;
  contactId: string;
  channelSlug: string;
  content: string;
}

export interface ReplyResult {
  conversationId: string;
  /** Queue job state: "queued" | "posting" (PENDING row). */
  state: "queued" | "posting";
}

/**
 * Send a reply: requires an existing thread (≥1 inbound message for this
 * contact × channel), creates the OUTBOUND row in PENDING state, then enqueues
 * the reply job — 202-style: the platform call happens in the worker.
 */
export async function sendReply(
  prisma: PrismaClient,
  publisher: Publisher,
  input: ReplyInput,
): Promise<ReplyResult> {
  const channel = await prisma.channel.findUnique({
    where: { slug: input.channelSlug },
  });
  if (!channel) throw new ApiError(404, "channel not found");

  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!contact) throw new ApiError(404, "contact not found");

  // Replies require an existing thread — the target is the latest inbound
  // message (its platform id becomes the adapter's reply target).
  const latestInbound = await prisma.conversation.findFirst({
    where: {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      channelId: channel.id,
      direction: "INBOUND",
    },
    orderBy: { timestamp: "desc" },
  });
  if (!latestInbound) {
    throw new ApiError(400, "no inbound message to reply to");
  }

  const conversation = await prisma.conversation.create({
    data: {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      channelId: channel.id,
      postId: latestInbound.postId,
      content: input.content,
      externalId: `local:reply:${randomUUID()}`,
      direction: "OUTBOUND",
      deliveryState: "PENDING",
    },
  });

  await publisher.enqueueReply({
    conversationId: conversation.id,
    workspaceId: input.workspaceId,
    channelSlug: input.channelSlug,
    content: input.content,
    replyToExternalId: latestInbound.externalId,
    postExternalId: null, // mock inbound carries no platform post id yet
  });

  return { conversationId: conversation.id, state: "queued" };
}
