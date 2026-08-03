// Interaction domain service (spec §1) — Content Touch application plus the
// rules-driven Contact state/persona recompute (schema comments: "State
// (real-time, rules-driven) — recomputed on Interaction events").
//
// Rules (Phase 1, intentionally simple — an AI upgrade path is documented in
// the spec; the ENGAGED threshold is a SpellPaw decision, not spec-mandated):
// - Lifecycle: AWARE → ENGAGED once a contact touches ≥2 distinct posts
//   within 30 days. No signals yet for ACTIVATED/LOYAL/AT_RISK/CHURNED.
// - Persona: rule-based stats over a 365-day window (action counts, distinct
//   posts). The "AI-derived" pipeline (spec §1) can later upgrade
//   personaContentDNA without changing the write path.
//
// Spec §5 asks the click worker to "batch INSERT ContentTouch" — this worker
// processes one click per job (documented deviation): contact resolution and
// state recompute are inherently per-click, and at Phase 1 volume a batch
// layer adds complexity without measurable gain.
import type { PrismaClient } from "@/generated/prisma/client";

export const ENGAGE_THRESHOLD_DISTINCT_POSTS = 2;
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

async function recomputeContactState(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  contactId: string,
): Promise<void> {
  const engageSince = new Date(Date.now() - ENGAGE_WINDOW_DAYS * 86_400_000);
  const distinctPosts = await tx.contentTouch.findMany({
    where: { contactId, timestamp: { gte: engageSince } },
    select: { postId: true },
    distinct: ["postId"],
  });
  const stage =
    distinctPosts.length >= ENGAGE_THRESHOLD_DISTINCT_POSTS ? "ENGAGED" : "AWARE";

  const personaSince = new Date(Date.now() - PERSONA_WINDOW_DAYS * 86_400_000);
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
