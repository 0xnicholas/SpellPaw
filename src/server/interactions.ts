// Interaction domain service (spec §1) — Content Touch application plus the
// rules-driven Contact state/persona recompute (schema comments: "State
// (real-time, rules-driven) — recomputed on Interaction events").
//
// Rules (Phase 1, intentionally simple — an AI upgrade path is documented in
// the spec; thresholds are SpellPaw decisions):
// - Lifecycle: AWARE → ENGAGED once a contact accumulates ≥3 Content Touch
//   within 30 days, OR records ≥1 Conversation within 30 days (M6 decision —
//   ADR-0013/glossary: replaces the M4 rule of ≥2 distinct posts).
//   ACTIVATED and beyond are sticky: manual activation (M6) sets ACTIVATED
//   and recompute never downgrades it. No signals yet for LOYAL/AT_RISK/CHURNED.
// - Contact type: AUDIENCE → CORRESPONDENT on the first Conversation (ever).
// - Persona: rule-based stats over a 365-day window (action counts, distinct
//   posts). The "AI-derived" pipeline (spec §1) can later upgrade
//   personaContentDNA without changing the write path.
//
// Spec §5 asks the click worker to "batch INSERT ContentTouch" — this worker
// processes one click per job (documented deviation): contact resolution and
// state recompute are inherently per-click, and at Phase 1 volume a batch
// layer adds complexity without measurable gain.
import type { PrismaClient } from "@/generated/prisma/client";

/** Transaction client as passed to $transaction callbacks. */
export type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export const ENGAGE_THRESHOLD_TOUCHES = 3;
export const ENGAGE_WINDOW_DAYS = 30;
export const PERSONA_WINDOW_DAYS = 365;

export type TouchAction = "CLICK" | "LIKE" | "SHARE";

export interface ClickEvent {
  workspaceId: string;
  /** null = anonymous (cookie-blocked) visitor — touch still counted. */
  contactId: string | null;
  postId: string;
  variantId: string;
  action?: TouchAction;
}

/**
 * Apply one click event: resolve the contact, insert the ContentTouch row,
 * then recompute the contact's lifecycle stage and persona stats — all in one
 * transaction, so the touch and its derived state stay consistent.
 */
export async function applyClick(
  prisma: PrismaClient,
  event: ClickEvent,
): Promise<void> {
  const variant = await prisma.postVariant.findUnique({
    where: { id: event.variantId },
    include: { channel: true },
  });
  if (!variant) throw new Error(`unknown variant ${event.variantId}`);

  await prisma.$transaction(async (tx) => {
    let contactId: string | null = null;
    if (event.contactId) {
      // Upsert (not create) — the redirect route pre-creates the contact
      // (visitor cookie race), and parallel clicks can collide. The route
      // cannot know the source channel, so fill it in when missing here.
      const existing = await tx.contact.findUnique({
        where: { id: event.contactId },
        select: { profileSourceChannel: true },
      });
      const contact = await tx.contact.upsert({
        where: { id: event.contactId },
        create: {
          id: event.contactId,
          workspaceId: event.workspaceId,
          type: "AUDIENCE",
          profileSourceChannel: variant.channel.slug,
        },
        update: existing?.profileSourceChannel ? {} : { profileSourceChannel: variant.channel.slug },
      });
      contactId = contact.id;
    }
    await tx.contentTouch.create({
      data: {
        contactId,
        postId: event.postId,
        variantId: event.variantId,
        action: event.action ?? "CLICK",
      },
    });
    if (contactId) {
      await recomputeContactState(tx, contactId);
    }
  });
}

/**
 * Recompute the contact's type (CORRESPONDENT on first Conversation), lifecycle
 * stage (M6 rule: ≥3 touches OR ≥1 conversation in 30d; ACTIVATED+ sticky) and
 * persona stats — run inside the caller's transaction so the interaction and
 * its derived state stay consistent.
 */
export async function recomputeContactState(
  tx: TxClient,
  contactId: string,
): Promise<void> {
  const current = await tx.contact.findUniqueOrThrow({
    where: { id: contactId },
    select: { stateLifecycleStage: true },
  });

  const engageSince = new Date(Date.now() - ENGAGE_WINDOW_DAYS * 86_400_000);
  const [touches, conversations] = await Promise.all([
    tx.contentTouch.count({
      where: { contactId, timestamp: { gte: engageSince } },
    }),
    tx.conversation.count({
      where: { contactId, timestamp: { gte: engageSince } },
    }),
  ]);

  // M6 rule: ≥3 touches OR ≥1 conversation within 30 days. ACTIVATED+ is
  // sticky — manual activation must never be downgraded by a recompute.
  const engaged = touches >= ENGAGE_THRESHOLD_TOUCHES || conversations >= 1;
  const manualStage = current.stateLifecycleStage === "ACTIVATED";
  const stage = manualStage
    ? "ACTIVATED"
    : engaged
      ? "ENGAGED"
      : "AWARE";

  // AUDIENCE → CORRESPONDENT on the first Conversation (ever).
  const totalConversations = await tx.conversation.count({ where: { contactId } });
  const type = totalConversations >= 1 ? "CORRESPONDENT" : "AUDIENCE";

  const personaSince = new Date(Date.now() - PERSONA_WINDOW_DAYS * 86_400_000);
  const distinctPosts = await tx.contentTouch.findMany({
    where: { contactId, timestamp: { gte: personaSince } },
    select: { postId: true },
    distinct: ["postId"],
  });
  const byAction = await tx.contentTouch.groupBy({
    by: ["action"],
    where: { contactId, timestamp: { gte: personaSince } },
    _count: { action: true },
  });
  const actionCounts = Object.fromEntries(
    byAction.map((row) => [row.action, row._count.action]),
  );

  await tx.contact.update({
    where: { id: contactId },
    data: {
      type,
      stateLifecycleStage: stage,
      personaContentDNA: {
        actionCounts,
        distinctPosts: distinctPosts.length,
        windowDays: PERSONA_WINDOW_DAYS,
        derivedAt: new Date().toISOString(),
      },
    },
  });
}
