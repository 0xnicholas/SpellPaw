// Persona AI derivation — M7-C batch path (ADR-0003 / ADR-0015).
//
// A cron scans Contacts flagged personaDirtyAt and derives the three Persona
// facets (Content DNA / Sentiment Arc / Intent) via the BYOK `complete()`
// primitive, then clears the dirty flag. This is the expensive path that must
// NOT run on the per-click incremental path.
//
// Content-egress gate (grilling Q5): derivation reads Contact message/Post
// text and sends it to the user's LLM — a more sensitive egress than the
// user's own Composer text. It runs ONLY when Workspace.personaDerivationEnabled
// is on (default off, mirrors ADR-0014). When off, the Contact is skipped and
// left dirty (derived once the gate flips on). Output is exposed only via the
// non-PII projection (ADR-0014 principle: AI-derivation domain may touch
// content; external interfaces never leak PII).
//
// NOTE (grilling Q1): at M7-C all data is Mock — this pipeline validates
// *plumbing* only; derivation QUALITY cannot be judged until real X data lands.
import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { complete, parseJsonLenient, type AiProvider } from "@/lib/ai/providers";
import { decryptString } from "@/lib/crypto";
import { PERSONA_WINDOW_DAYS } from "./interactions";

const PERSONA_BATCH_PATTERN = process.env.PERSONA_BATCH_CRON ?? "0 * * * *";
const PERSONA_BATCH_DEFAULT = 50;
const TOUCH_SAMPLE = 50;
const CONVERSATION_SAMPLE = 50;

export const PERSONA_DERIVE_QUEUE = "persona-derive";
export const PERSONA_DERIVE_JOB = "run-persona-derive";
export const personaBatchPattern = () => PERSONA_BATCH_PATTERN;

export interface PersonaDerivation {
  contentDNA: {
    topics: { label: string; weight: number }[];
    channelAffinity: Record<string, number>;
    toneAffinity: string[];
  };
  sentimentArc: {
    points: { ts: string; score: number; label: string }[];
    trend: "improving" | "stable" | "declining";
    currentScore: number;
  };
  intent: {
    category: "explore" | "engage" | "buy" | "complaint" | "churn" | "dormant";
    confidence: number;
    evidence: string[];
  };
}

const SYSTEM_PROMPT = [
  "You derive a concise Contact persona from their interaction history.",
  "You receive: posts the Contact engaged with (with action) and their conversation messages.",
  "Return ONLY a JSON object with EXACTLY this shape:",
  `{ "contentDNA": { "topics": [{"label": string, "weight": 0..1}], "channelAffinity": {"<slug>": 0..1}, "toneAffinity": [string] },`,
  `  "sentimentArc": { "points": [{"ts": ISO, "score": -1..1, "label": string}], "trend": "improving"|"stable"|"declining", "currentScore": -1..1 },`,
  `  "intent": { "category": "explore"|"engage"|"buy"|"complaint"|"churn"|"dormant", "confidence": 0..1, "evidence": [string] } }`,
  "Content DNA: what content types/channels/tone the Contact responds to most.",
  "Sentiment Arc: emotional trend over time from conversation messages (omit if none).",
  "Intent: current intent direction from recent interactions. Be concise; no prose.",
].join("\n");

/** Pure prompt builder (no I/O) — exported for unit testing. */
export function buildPersonaPrompt(
  touchedPosts: { content: string; action: string; channel?: string }[],
  conversations: { content: string; direction: string; timestamp: Date }[],
): { system: string; user: string } {
  const posts = touchedPosts
    .filter((p) => p.content.trim())
    .map((p, i) => `${i + 1}. [${p.action}${p.channel ? ` @${p.channel}` : ""}] ${p.content.slice(0, 280)}`)
    .join("\n");
  const convs = conversations
    .map((c) => `- (${c.direction} @${c.timestamp.toISOString().slice(0, 10)}) ${c.content.slice(0, 280)}`)
    .join("\n");
  return {
    system: SYSTEM_PROMPT,
    user: `ENGAGED POSTS:\n${posts || "(none)"}\n\nCONVERSATIONS:\n${convs || "(none)"}`,
  };
}

/** Defensive coercion of the parsed model output into the typed shape. */
function coerceDerivation(raw: unknown): PersonaDerivation {
  const o = (raw ?? {}) as Record<string, unknown>;
  const dna = (o.contentDNA ?? {}) as Record<string, unknown>;
  const arc = (o.sentimentArc ?? {}) as Record<string, unknown>;
  const intent = (o.intent ?? {}) as Record<string, unknown>;
  return {
    contentDNA: {
      topics: Array.isArray(dna.topics) ? (dna.topics as PersonaDerivation["contentDNA"]["topics"]) : [],
      channelAffinity:
        dna.channelAffinity && typeof dna.channelAffinity === "object"
          ? (dna.channelAffinity as Record<string, number>)
          : {},
      toneAffinity: Array.isArray(dna.toneAffinity) ? (dna.toneAffinity as string[]) : [],
    },
    sentimentArc: {
      points: Array.isArray(arc.points) ? (arc.points as PersonaDerivation["sentimentArc"]["points"]) : [],
      trend: (["improving", "stable", "declining"].includes(arc.trend as string)
        ? (arc.trend as PersonaDerivation["sentimentArc"]["trend"])
        : "stable"),
      currentScore: typeof arc.currentScore === "number" ? arc.currentScore : 0,
    },
    intent: {
      category: (["explore", "engage", "buy", "complaint", "churn", "dormant"].includes(intent.category as string)
        ? (intent.category as PersonaDerivation["intent"]["category"])
        : "dormant"),
      confidence: typeof intent.confidence === "number" ? intent.confidence : 0,
      evidence: Array.isArray(intent.evidence) ? (intent.evidence as string[]) : [],
    },
  };
}

export type DeriveOutcome = "derived" | "gate-off" | "no-key" | "no-content" | "skipped" | "failed";

/**
 * Derive Persona for one Contact. Respects the content-egress gate; writes the
 * three facets + clears dirty on success/fallback, leaves dirty on AI failure
 * (retried next cron). Never throws — returns an outcome for the batch loop.
 */
export async function derivePersonaForContact(
  prisma: PrismaClient,
  contactId: string,
  encryptionKey: Buffer,
  // Injected for tests (defaults to the real complete()).
  completer: (opts: { provider: AiProvider; apiKey: string; system: string; user: string; json: boolean }) => Promise<string> = complete,
): Promise<DeriveOutcome> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { workspaceId: true, personaDirtyAt: true },
  });
  if (!contact || !contact.personaDirtyAt) return "skipped";

  const ws = await prisma.workspace.findUnique({
    where: { id: contact.workspaceId },
    select: { personaDerivationEnabled: true },
  });
  // Gate off (default) → do NOT egress content; leave dirty for when it's on.
  if (!ws?.personaDerivationEnabled) return "gate-off";

  // Gather content (last 365d, bounded samples — token control).
  const since = new Date(Date.now() - PERSONA_WINDOW_DAYS * 86_400_000);
  const [touches, conversations] = await Promise.all([
    prisma.contentTouch.findMany({
      where: { contactId, timestamp: { gte: since } },
      select: { variantId: true, action: true, post: { select: { title: true } } },
      take: TOUCH_SAMPLE,
      orderBy: { timestamp: "desc" },
    }),
    prisma.conversation.findMany({
      where: { contactId, timestamp: { gte: since } },
      select: { content: true, direction: true, timestamp: true },
      take: CONVERSATION_SAMPLE,
      orderBy: { timestamp: "asc" },
    }),
  ]);
  const variantIds = [...new Set(touches.map((t) => t.variantId).filter(Boolean))] as string[];
  const variants = variantIds.length
    ? await prisma.postVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, content: true, channel: { select: { slug: true } } },
      })
    : [];
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const touchedPosts = touches.map((t) => {
    const v = t.variantId ? variantById.get(t.variantId) : undefined;
    return {
      action: t.action,
      content: v?.content || t.post?.title || "",
      channel: v?.channel?.slug,
    };
  });

  if (touchedPosts.length === 0 && conversations.length === 0) {
    await clearDirty(prisma, contactId);
    return "no-content";
  }

  // No BYOK key (gate on) → rule-based fallback + clear dirty (no retry storm).
  const keyRow = await prisma.modelProviderKey.findFirst({
    where: { workspaceId: contact.workspaceId, isActive: true },
  });
  if (!keyRow) {
    await writeFallbackPersona(prisma, contactId);
    return "no-key";
  }

  const { system, user } = buildPersonaPrompt(touchedPosts, conversations);
  try {
    const raw = await completer({
      provider: keyRow.provider as AiProvider,
      apiKey: decryptString(keyRow.encryptedKey, encryptionKey),
      system,
      user,
      json: true,
    });
    const derivation = coerceDerivation(parseJsonLenient(raw));
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        personaContentDNA: derivation.contentDNA,
        personaSentimentArc: derivation.sentimentArc,
        personaIntent: { ...derivation.intent, derivedAt: new Date().toISOString() },
        personaDirtyAt: null,
      },
    });
    return "derived";
  } catch (err) {
    // AI failure: keep prior Persona, leave dirty → retried next cron.
    console.error("[persona] derivation failed for", contactId, err);
    return "failed";
  }
}

async function clearDirty(prisma: PrismaClient, contactId: string): Promise<void> {
  await prisma.contact.update({ where: { id: contactId }, data: { personaDirtyAt: null } });
}

async function writeFallbackPersona(prisma: PrismaClient, contactId: string): Promise<void> {
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      // personaContentDNA stays as the rule-based placeholder (from recompute).
      personaSentimentArc: Prisma.DbNull,
      personaIntent: { category: "dormant", confidence: 0, evidence: [], derivedAt: new Date().toISOString() },
      personaDirtyAt: null,
    },
  });
}

/**
 * Scan dirty Contacts and derive. Exported for direct testing (same shape as
 * runStateDecay). Only needs prisma + encryptionKey.
 */
export async function runPersonaBatch(
  deps: { prisma: PrismaClient; encryptionKey: Buffer },
  completer?: Parameters<typeof derivePersonaForContact>[3],
): Promise<{ scanned: number; results: Record<DeriveOutcome, number> }> {
  const { prisma, encryptionKey } = deps;
  const batchRaw = Number(process.env.PERSONA_BATCH_SIZE);
  const batch = Number.isInteger(batchRaw) && batchRaw > 0 ? batchRaw : PERSONA_BATCH_DEFAULT;
  const dirty = await prisma.contact.findMany({
    where: { personaDirtyAt: { not: null } },
    orderBy: { personaDirtyAt: "asc" },
    take: batch,
    select: { id: true },
  });
  const results: Record<DeriveOutcome, number> = {
    derived: 0, "gate-off": 0, "no-key": 0, "no-content": 0, skipped: 0, failed: 0,
  };
  for (const c of dirty) {
    const outcome = await derivePersonaForContact(prisma, c.id, encryptionKey, completer);
    results[outcome] += 1;
  }
  return { scanned: dirty.length, results };
}

export const personaBatchCronInfo = () => ({ queue: PERSONA_DERIVE_QUEUE, job: PERSONA_DERIVE_JOB, pattern: PERSONA_BATCH_PATTERN });
