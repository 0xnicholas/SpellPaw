// /api/contacts routes — Customer Graph reads. M3 ships schema + read surface;
// data is written from M4 (ContentTouch) and Phase 2 (Conversations).
// PII contract (spec §3): contact endpoints NEVER return profile_* columns.
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../errors";
import { NON_PII_SELECT } from "../contact-select";
import { manuallyActivateContact } from "../inbox";
import type { AppEnv, RouteDeps } from "./shared";

const listQuerySchema = z.object({
  stage: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.enum(["AWARE", "ENGAGED", "ACTIVATED", "LOYAL", "AT_RISK", "CHURNED"]))
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function contactsRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Must be registered before /:id.
  app.get("/insights/repeat-viewers", async (c) => {
    // Contacts that touched ≥2 distinct posts (spec §2). Workspace-scoped via
    // the Post join; returns the NON_PII projection only.
    const viewers = await deps.prisma.$queryRaw<
      Array<{
        id: string;
        stateLifecycleStage: string;
        personaContentDNA: unknown;
        updatedAt: Date;
        postCount: number;
        touchCount: number;
      }>
    >`
      SELECT c."id", c."stateLifecycleStage", c."personaContentDNA", c."updatedAt",
             count(DISTINCT ct."postId")::int AS "postCount",
             count(ct."id")::int AS "touchCount"
      FROM "Contact" c
      JOIN "ContentTouch" ct ON ct."contactId" = c."id"
      JOIN "Post" p ON p."id" = ct."postId"
      WHERE p."workspaceId" = ${c.get("workspaceId")}
      GROUP BY c."id"
      HAVING count(DISTINCT ct."postId") >= 2
      ORDER BY "touchCount" DESC
      LIMIT 20
    `;
    return c.json({
      viewers: viewers.map((v) => ({
        id: v.id,
        stateLifecycleStage: v.stateLifecycleStage,
        personaContentDNA: v.personaContentDNA,
        updatedAt: v.updatedAt,
        postCount: v.postCount,
        touchCount: v.touchCount,
      })),
    });
  });

  app.get("/", async (c) => {
    const parsed = listQuerySchema.safeParse({
      stage: c.req.query("stage") ?? undefined,
      limit: c.req.query("limit") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(400, "stage must be one of AWARE/ENGAGED/ACTIVATED/LOYAL/AT_RISK/CHURNED");
    }
    const { stage, limit } = parsed.data;
    const contacts = await deps.prisma.contact.findMany({
      where: {
        workspaceId: c.get("workspaceId"),
        ...(stage ? { stateLifecycleStage: stage } : {}),
      },
      select: NON_PII_SELECT,
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    return c.json({ contacts });
  });

  app.get("/:id", async (c) => {
    const contact = await deps.prisma.contact.findFirst({
      where: { id: c.req.param("id"), workspaceId: c.get("workspaceId") },
      select: NON_PII_SELECT,
    });
    if (!contact) throw new ApiError(404, "contact not found");
    // Raw signals alongside the heuristic scores (grilling Q3): an MCP
    // consumer's agent can override the scores and reason for itself.
    const windowSince = new Date(Date.now() - 30 * 86_400_000);
    const [touches30d, conversations30d] = await Promise.all([
      deps.prisma.contentTouch.count({
        where: { contactId: contact.id, timestamp: { gte: windowSince } },
      }),
      deps.prisma.conversation.count({
        where: { contactId: contact.id, timestamp: { gte: windowSince } },
      }),
    ]);
    const daysSinceLastInteraction = contact.lastInteractionAt
      ? Math.floor((Date.now() - contact.lastInteractionAt.getTime()) / 86_400_000)
      : null;
    return c.json({
      contact,
      signals: { daysSinceLastInteraction, touches30d, conversations30d },
    });
  });

  // M6: recent interaction timeline for the Inbox sidebar — reads the
  // contact_timeline VIEW (ContentTouch / Conversation / Event merged).
  // Payload carries no PII (postId/action, externalId/direction, eventType).
  app.get("/:id/timeline", async (c) => {
    const contact = await deps.prisma.contact.findFirst({
      where: { id: c.req.param("id"), workspaceId: c.get("workspaceId") },
      select: { id: true },
    });
    if (!contact) throw new ApiError(404, "contact not found");
    const rows = await deps.prisma.$queryRaw<
      Array<{ type: string; timestamp: Date; payload: Record<string, unknown> }>
    >`
      SELECT "type", "timestamp", "payload"
      FROM contact_timeline
      WHERE "contactId" = ${contact.id}
      ORDER BY "timestamp" DESC
      LIMIT 20
    `;
    return c.json({
      timeline: rows.map((r) => ({ ...r, timestamp: r.timestamp.toISOString() })),
    });
  });

  // M6: manual activation (ADR-0013 lifecycle) — user asserts product-usage
  // evidence; records a timeline Event and sets ACTIVATED (sticky).
  app.post("/:id/activate", async (c) => {
    const contact = await deps.prisma.contact.findFirst({
      where: { id: c.req.param("id"), workspaceId: c.get("workspaceId") },
      select: { id: true },
    });
    if (!contact) throw new ApiError(404, "contact not found");
    await manuallyActivateContact(deps.prisma, c.get("workspaceId"), contact.id);
    return c.json({ ok: true, contactId: contact.id, stateLifecycleStage: "ACTIVATED" });
  });

  return app;
}
