// /api/posts + /api/variants routes.
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../errors";
import { createPost, listPosts, publishPost } from "../posts";
import { enrichQueueStates, readJson, type AppEnv, type RouteDeps } from "./shared";

const postCreateSchema = z.object({
  title: z.string().trim().max(200).optional().nullable(),
  variants: z.array(z.object({ channelSlug: z.string().min(1), content: z.string() })).min(1),
});

export function postsRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const posts = await listPosts(deps.prisma, c.get("workspaceId"));
    await enrichQueueStates(deps, posts);
    return c.json({ posts });
  });

  app.post("/", async (c) => {
    const body = await readJson(c, postCreateSchema);
    const post = await createPost(deps.prisma, {
      workspaceId: c.get("workspaceId"),
      title: body.title ?? null,
      variants: body.variants,
    });
    return c.json({ post }, 201);
  });

  app.get("/:id", async (c) => {
    const post = await deps.prisma.post.findFirst({
      where: { id: c.req.param("id"), workspaceId: c.get("workspaceId") },
      include: { variants: { include: { channel: true }, orderBy: { id: "asc" as const } } },
    });
    if (!post) throw new ApiError(404, "post not found");
    await enrichQueueStates(deps, [post]);
    return c.json({ post });
  });

  app.post("/:id/publish", async (c) => {
    const result = await publishPost(deps.prisma, deps.publisher, c.get("workspaceId"), c.req.param("id"));
    // 202 Accepted — the queue performs the publish asynchronously.
    return c.json(result, 202);
  });

  app.delete("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const post = await deps.prisma.post.findFirst({ where: { id: c.req.param("id"), workspaceId } });
    if (!post) throw new ApiError(404, "post not found");
    await deps.prisma.post.delete({ where: { id: post.id } });
    return c.json({ deleted: true });
  });

  return app;
}
