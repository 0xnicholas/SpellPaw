import { Hono } from "hono";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";
import { ApiError } from "../errors";
import type { AppEnv, RouteDeps } from "./shared";

// Analytics surface (spec §2): dashboard rollup, per-post drilldown, top
// posts. All queries are workspace-scoped via the Post join — ContentTouch has
// no workspaceId column by design (spec §1 partitioned model).
//
// Security note: every user-supplied value (limit, postId) is bound through
// Prisma.sql tagged parameters — never string-interpolated into SQL.

const topPostsSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(5) });

export function analyticsRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Must be registered before /posts/:id.
  app.get("/top-posts", async (c) => {
    const parsed = topPostsSchema.safeParse({ limit: c.req.query("limit") ?? undefined });
    if (!parsed.success) throw new ApiError(400, "invalid limit");
    const rows = await touchRows(
      deps.prisma,
      c.get("workspaceId"),
      Prisma.sql`GROUP BY ct."postId" ORDER BY count(*) DESC LIMIT ${parsed.data.limit}`,
    );
    return c.json({ posts: rows });
  });

  app.get("/dashboard", async (c) => {
    const workspaceId = c.get("workspaceId");
    const [totalTouches, uniqueContacts, repeatViewers, stageDistribution, touchesByDay, topPosts] =
      await Promise.all([
        deps.prisma.contentTouch.count({ where: { post: { workspaceId } } }),
        distinctContacts(deps.prisma, workspaceId),
        repeatViewerCount(deps.prisma, workspaceId),
        deps.prisma.contact.groupBy({
          by: ["stateLifecycleStage"],
          where: { workspaceId },
          _count: { id: true },
        }),
        touchesByDayRows(deps.prisma, workspaceId),
        touchRows(
          deps.prisma,
          workspaceId,
          Prisma.sql`GROUP BY ct."postId" ORDER BY count(*) DESC LIMIT 5`,
        ),
      ]);
    return c.json({
      totalTouches,
      uniqueContacts,
      repeatViewers,
      stageDistribution: stageDistribution.map((s) => ({
        stage: s.stateLifecycleStage,
        count: s._count.id,
      })),
      touchesByDay,
      topPosts,
    });
  });

  app.get("/posts/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const postId = c.req.param("id");
    const post = await deps.prisma.post.findFirst({
      where: { id: postId, workspaceId },
      include: { variants: { include: { channel: true } } },
    });
    if (!post) throw new ApiError(404, "POST_NOT_FOUND");

    const [byVariant, byDay, recent] = await Promise.all([
      deps.prisma.contentTouch.groupBy({
        by: ["variantId"],
        where: { postId },
        _count: { id: true },
      }),
      touchesByDayRows(deps.prisma, workspaceId, postId),
      deps.prisma.contentTouch.findMany({
        where: { postId },
        orderBy: { timestamp: "desc" },
        take: 20,
        select: { contactId: true, action: true, timestamp: true, variantId: true },
      }),
    ]);
    return c.json({
      post: { id: post.id, title: post.title, status: post.status, publishedAt: post.publishedAt },
      variants: post.variants.map((v) => ({
        channelSlug: v.channel.slug,
        clicks: byVariant.find((r) => r.variantId === v.id)?._count.id ?? 0,
      })),
      touchesByDay: byDay,
      recentTouches: recent,
    });
  });

  return app;
}

function touchRows(
  prisma: PrismaClient,
  workspaceId: string,
  clause: Prisma.Sql,
): Promise<{ postId: string; title: string | null; clicks: number }[]> {
  return prisma.$queryRaw<{ postId: string; title: string | null; clicks: number }[]>`
    SELECT ct."postId" AS "postId", max(p.title) AS title, count(*)::int AS clicks
    FROM "ContentTouch" ct JOIN "Post" p ON p.id = ct."postId"
    WHERE p."workspaceId" = ${workspaceId}
    ${clause}
  `;
}

async function distinctContacts(prisma: PrismaClient, workspaceId: string): Promise<number> {
  const rows = await prisma.contentTouch.groupBy({
    by: ["contactId"],
    where: { post: { workspaceId }, contactId: { not: null } },
    _count: { id: true },
  });
  return rows.length;
}

function repeatViewerCount(prisma: PrismaClient, workspaceId: string): Promise<number> {
  return prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM (
      SELECT ct."contactId"
      FROM "ContentTouch" ct JOIN "Post" p ON p.id = ct."postId"
      WHERE p."workspaceId" = ${workspaceId} AND ct."contactId" IS NOT NULL
      GROUP BY ct."contactId"
      HAVING count(DISTINCT ct."postId") >= 2
    ) viewers
  `.then((rows) => rows[0]?.count ?? 0);
}

function touchesByDayRows(
  prisma: PrismaClient,
  workspaceId: string,
  postId?: string,
): Promise<{ day: string; clicks: number }[]> {
  const postFilter = postId ? Prisma.sql`AND ct."postId" = ${postId}` : Prisma.empty;
  return prisma.$queryRaw<{ day: string; clicks: number }[]>`
    SELECT to_char(date_trunc('day', ct."timestamp"), 'YYYY-MM-DD') AS day, count(*)::int AS clicks
    FROM "ContentTouch" ct JOIN "Post" p ON p.id = ct."postId"
    WHERE p."workspaceId" = ${workspaceId}
      AND ct."timestamp" >= now() - interval '14 days'
      ${postFilter}
    GROUP BY 1 ORDER BY 1
  `;
}
