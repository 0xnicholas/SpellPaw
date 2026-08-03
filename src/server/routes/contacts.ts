// /api/contacts routes — Customer Graph reads. M3 ships schema + read surface;
// data is written from M4 (ContentTouch) and Phase 2 (Conversations).
// PII contract (spec §3): contact endpoints NEVER return profile_* columns.
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../errors";
import { NON_PII_SELECT } from "../contact-select";
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
    // Interaction timeline arrives with M4/Phase 2; Persona/State are the payload today.
    return c.json({ contact });
  });

  return app;
}
