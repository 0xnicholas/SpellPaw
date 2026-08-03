// Free-plan guardrails (ADR-0012): abuse limits, not a paywall.
//
// Env-configurable: FREE_PLAN_MAX_CHANNELS / FREE_PLAN_MAX_POSTS /
// FREE_PLAN_MAX_CONTACTS (defaults 3 / 50 / 1000; 0 = unlimited). Exceeding
// a limit is a hard 429-style rejection on interactive create paths — except
// the public short-link redirect, which must never fail: when the contact
// budget is exhausted the click degrades to an anonymous touch instead.
import type { PrismaClient } from "@/generated/prisma/client";
import { ApiError } from "./errors";

export interface PlanLimits {
  maxChannels: number;
  maxPosts: number;
  maxContacts: number;
}

export function planLimits(env: NodeJS.ProcessEnv = process.env): PlanLimits {
  const num = (v: string | undefined, fallback: number) => {
    if (v === undefined || v === "") return fallback;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  return {
    maxChannels: num(env.FREE_PLAN_MAX_CHANNELS, 3),
    maxPosts: num(env.FREE_PLAN_MAX_POSTS, 50),
    maxContacts: num(env.FREE_PLAN_MAX_CONTACTS, 1000),
  };
}

async function countContacts(prisma: PrismaClient, workspaceId: string): Promise<number> {
  return prisma.contact.count({ where: { workspaceId } });
}

/** Interactive create paths — hard reject once the budget is spent. */
export async function enforceChannelLimit(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<void> {
  const { maxChannels } = planLimits();
  if (maxChannels === 0) return;
  const used = await prisma.oAuthConnection.count({ where: { workspaceId } });
  if (used >= maxChannels) {
    throw new ApiError(
      429,
      `channel limit reached (${maxChannels}) — disconnect one or raise FREE_PLAN_MAX_CHANNELS`,
    );
  }
}

export async function enforcePostLimit(prisma: PrismaClient, workspaceId: string): Promise<void> {
  const { maxPosts } = planLimits();
  if (maxPosts === 0) return;
  const used = await prisma.post.count({ where: { workspaceId } });
  if (used >= maxPosts) {
    throw new ApiError(
      429,
      `post limit reached (${maxPosts}) — delete drafts or raise FREE_PLAN_MAX_POSTS`,
    );
  }
}

/**
 * Contact budget check for the public redirect path. Returns true when the
 * visitor can be attributed to a contact row. When the budget is exhausted
 * the caller records an anonymous touch instead — the redirect itself never
 * fails (ADR-0009: <30ms, never blocked on writes).
 */
export async function contactBudgetAvailable(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<boolean> {
  const { maxContacts } = planLimits();
  if (maxContacts === 0) return true;
  const used = await countContacts(prisma, workspaceId);
  return used < maxContacts;
}

/** Usage snapshot for the Settings UI + /api/settings/workspace. */
export async function planUsage(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<PlanLimits & { usedChannels: number; usedPosts: number; usedContacts: number }> {
  const [channels, posts, contacts] = await Promise.all([
    prisma.oAuthConnection.count({ where: { workspaceId } }),
    prisma.post.count({ where: { workspaceId } }),
    prisma.contact.count({ where: { workspaceId } }),
  ]);
  return { ...planLimits(), usedChannels: channels, usedPosts: posts, usedContacts: contacts };
}
