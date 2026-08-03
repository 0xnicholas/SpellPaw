// Short-link redirect (ADR-0009) — the public click entry point.
//
// Documented deviation from the ADR: served by a Node route handler instead
// of Next.js Middleware. Middleware runs on the edge runtime, where BullMQ
// (node) cannot enqueue reliably; the route keeps the same Redis-cached 301
// semantics (well under 30ms on cache hits) and fire-and-forget attribution.
//
// Visitor identity: a `sp_c` cookie carries the contact id (created on first
// click). Cookie-blocked visitors still count as anonymous touches.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { resolveShortLink } from "@/server/shortlinks";
import { clickQueue } from "@/server/queue";
import { contactBudgetAvailable } from "@/server/limits";

const VISITOR_COOKIE = "sp_c";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

interface ShortLinkHandlerDeps {
  prisma: PrismaClient;
  redisUrl: string;
}

export function createShortLinkHandler(deps: ShortLinkHandlerDeps) {
  const redis = getRedis();
  const cache = redis
    ? {
        get: (k: string) => redis.get(k),
        set: (k: string, v: string, ttlSec: number) => redis.set(k, v, "EX", ttlSec),
      }
    : null;

  return async function GET(
    req: Request,
    { params }: { params: Promise<{ code: string }> },
  ): Promise<Response> {
    const { code } = await params;
    const link = await resolveShortLink(deps.prisma, code, cache);
    if (!link) return new Response("Not found", { status: 404 });

    const { contactId, isNewVisitor } = await resolveVisitor(deps, req, link.workspaceId);
    const queue = clickQueue(deps.redisUrl);
    // Fire-and-forget: the redirect must not block on attribution (ADR-0009).
    queue
      .add("click", {
        workspaceId: link.workspaceId,
        contactId,
        postId: link.postId,
        variantId: link.variantId,
      })
      .catch((err) => console.error("[click] enqueue failed", err))
      .finally(() => queue.close().catch(() => {}));

    // Response.redirect() returns an immutable Response — build manually so the
    // visitor cookie can be attached (mutable headers).
    const res = new Response(null, {
      status: 301,
      headers: { Location: link.targetUrl },
    });
    if (isNewVisitor) {
      const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
      res.headers.set(
        "Set-Cookie",
        `${VISITOR_COOKIE}=${contactId}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`,
      );
    }
    return res;
  };
}

async function resolveVisitor(
  deps: ShortLinkHandlerDeps,
  req: Request,
  workspaceId: string,
): Promise<{ contactId: string | null; isNewVisitor: boolean }> {
  const cookie = readVisitorCookie(req);
  if (cookie) {
    // Validate ownership — a cookie from another workspace must not be
    // attributed to this workspace's post.
    const contact = await deps.prisma.contact.findFirst({
      where: { id: cookie, workspaceId },
      select: { id: true },
    });
    if (contact) return { contactId: contact.id, isNewVisitor: false };
  }
  // Guardrail (ADR-0012): once the free-plan contact budget is exhausted the
  // redirect degrades to an anonymous touch instead of failing — the redirect
  // itself must never be blocked by a quota check.
  const budgetOk = await contactBudgetAvailable(deps.prisma, workspaceId);
  if (!budgetOk) return { contactId: null, isNewVisitor: false };
  // Create the contact row NOW (not in the worker): the redirect response
  // sets the cookie immediately, and a second click can arrive before the
  // async click job is processed — the upsert makes that race safe.
  const contactId = randomUUID();
  await deps.prisma.contact
    .upsert({
      where: { id: contactId },
      create: { id: contactId, workspaceId, type: "AUDIENCE" },
      update: {},
    })
    .catch((err) => {
      // Parallel first-clicks with the same fresh id are impossible (uuid),
      // but a DB hiccup must not break the redirect — the worker retries the
      // upsert anyway.
      console.error("[click] visitor contact create failed", err);
    });
  return { contactId, isNewVisitor: true };
}

function readVisitorCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === VISITOR_COOKIE && rest.length > 0) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null; // malformed cookie — treat as a fresh visitor
      }
    }
  }
  return null;
}

const handler = createShortLinkHandler({
  prisma,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
});

export { handler as GET };
