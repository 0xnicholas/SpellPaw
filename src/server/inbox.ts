// Inbox domain service (M6 — ADR-0013 "row-as-message").
// The single inbound path: any source of incoming messages (the mock-comment
// queue job today, a real channel fetchInbound poll later) funnels through
// recordInboundMessage, so dedup, contact resolution and lifecycle recompute
// live in exactly one place.
import type { PrismaClient } from "@/generated/prisma/client";
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
