// Interaction domain service (spec §1) — Content Touch application plus the
// rules-driven Contact state/persona recompute (schema comments: "State
// (real-time, rules-driven) — recomputed on Interaction events").
//
// M7-A (ADR-0015): the full Lifecycle Stage machine + Risk/Opportunity scoring
// live in the pure domain module src/domain/contact-state.ts (computeState).
// This service is the DB-writing wrapper: it gathers observable signals from
// the contact_timeline VIEW + counts, calls computeState, and persists stage +
// scores + lastInteractionAt + personaDirtyAt in the same transaction as the
// Interaction write. Time-driven decay (AT_RISK/CHURNED) is advanced by the
// daily state-decay cron (src/server/queue.ts runStateDecay).
//
// - Contact type: AUDIENCE → CORRESPONDENT on the first Conversation (ever).
// - Persona: rule-based stats over a 365-day window (placeholder). The
//   "AI-derived" pipeline (M7-C) later upgrades personaContentDNA without
//   changing this write path.
//
// Spec §5 asks the click worker to "batch INSERT ContentTouch" — this worker
// processes one click per job (documented deviation): contact resolution and
// state recompute are inherently per-click, and at Phase 1 volume a batch
// layer adds complexity without measurable gain.
import type { PrismaClient } from "@/generated/prisma/client";
import {
  computeState,
  enteredChurned,
  stateConfig,
  type LifecycleStage,
} from "@/domain/contact-state";

/** Transaction client as passed to $transaction callbacks. */
export type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Persona derivation window (rule-based placeholder until M7-C AI derivation). */
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
 * Recompute the Contact's type (CORRESPONDENT on first Conversation), full
 * Lifecycle Stage (M7-A — now LOYAL/AT_RISK/CHURNED via computeState), the
 * Risk/Opportunity scores, and the rule-based Persona placeholder — run
 * inside the caller's transaction so the Interaction and its derived state
 * stay consistent. Also stamps lastInteractionAt + personaDirtyAt.
 */
export async function recomputeContactState(
  tx: TxClient,
  contactId: string,
): Promise<void> {
  const cfg = stateConfig();
  const now = new Date();
  const windowSince = new Date(now.getTime() - cfg.engageWindowDays * 86_400_000);
  const yearSince = new Date(now.getTime() - PERSONA_WINDOW_DAYS * 86_400_000);

  const current = await tx.contact.findUniqueOrThrow({
    where: { id: contactId },
    select: { stateLifecycleStage: true, activatedAt: true },
  });
  const currentStage = current.stateLifecycleStage as LifecycleStage;

  // lastInteractionAt + 365d volume come from the merged timeline VIEW (one
  // query each) so we don't UNION three tables by hand.
  const [lastRows, volumeRows, touchesWindow, conversationsWindow, totalConversations] =
    await Promise.all([
      tx.$queryRaw<Array<{ last: Date | null }>>`SELECT MAX(timestamp) AS last FROM contact_timeline WHERE "contactId" = ${contactId}`,
      tx.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM contact_timeline WHERE "contactId" = ${contactId} AND timestamp >= ${yearSince}`,
      tx.contentTouch.count({ where: { contactId, timestamp: { gte: windowSince } } }),
      tx.conversation.count({ where: { contactId, timestamp: { gte: windowSince } } }),
      tx.conversation.count({ where: { contactId } }),
    ]);

  const lastInteractionAt = lastRows[0]?.last ?? now;
  const volume365d = volumeRows[0]?.n ?? 0;
  const daysSinceLastInteraction = lastInteractionAt
    ? Math.floor((now.getTime() - lastInteractionAt.getTime()) / 86_400_000)
    : 0;

  // LOYAL eligibility only matters for activated Contacts — skip the month
  // query for everyone else (keeps the hot path lean).
  let recentActiveMonths = 0;
  if (current.activatedAt) {
    // First day of the month (loyalMonths - 1) before the current month, so the
    // window spans exactly loyalMonths calendar months.
    const loyalSince = new Date(now.getFullYear(), now.getMonth() - (cfg.loyalMonths - 1), 1);
    const monthRows = await tx.$queryRaw<Array<{ m: number }>>`SELECT COUNT(DISTINCT date_trunc('month', timestamp))::int AS m FROM contact_timeline WHERE "contactId" = ${contactId} AND timestamp >= ${loyalSince}`;
    recentActiveMonths = monthRows[0]?.m ?? 0;
  }

  const result = computeState(
    {
      manualActivated: current.activatedAt !== null,
      currentStage,
      touchesWindow,
      conversationsWindow,
      recentActiveMonths,
      daysSinceLastInteraction,
      volume365d,
    },
    cfg,
  );

  // AUDIENCE → CORRESPONDENT on the first Conversation (ever).
  const type = totalConversations >= 1 ? "CORRESPONDENT" : "AUDIENCE";

  // Rule-based Persona placeholder (upgraded to real AI derivation in M7-C).
  const distinctPosts = await tx.contentTouch.findMany({
    where: { contactId, timestamp: { gte: yearSince } },
    select: { postId: true },
    distinct: ["postId"],
  });
  const byAction = await tx.contentTouch.groupBy({
    by: ["action"],
    where: { contactId, timestamp: { gte: yearSince } },
    _count: { action: true },
  });
  const actionCounts = Object.fromEntries(
    byAction.map((row) => [row.action, row._count.action]),
  );

  await tx.contact.update({
    where: { id: contactId },
    data: {
      type,
      stateLifecycleStage: result.stage,
      stateRiskScore: result.riskScore,
      stateOpportunityScore: result.opportunityScore,
      lastInteractionAt: lastInteractionAt ?? now,
      personaDirtyAt: now,
      personaContentDNA: {
        actionCounts,
        distinctPosts: distinctPosts.length,
        windowDays: PERSONA_WINDOW_DAYS,
        derivedAt: now.toISOString(),
      },
      // Entering CHURNED clears the activation flag — full journey-reset so
      // the "→ Aware" recovery progresses cleanly, not flickering to ACTIVATED.
      ...(enteredChurned(currentStage, result.stage) ? { activatedAt: null } : {}),
    },
  });
}
