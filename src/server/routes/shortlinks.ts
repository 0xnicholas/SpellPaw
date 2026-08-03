import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../errors";
import { createShortLink, shortLinkUrl } from "../shortlinks";
import { readJson, type AppEnv, type RouteDeps } from "./shared";

const shortenSchema = z.object({
  postId: z.string().min(1),
  variantId: z.string().min(1),
  targetUrl: z.string().url().startsWith("http"),
});

export function shortLinksRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await readJson(c, shortenSchema);
    const workspaceId = c.get("workspaceId");
    // Ownership: variant must belong to this workspace and to the post.
    const variant = await deps.prisma.postVariant.findFirst({
      where: { id: body.variantId, postId: body.postId, post: { workspaceId } },
      select: { id: true },
    });
    if (!variant) throw new ApiError(404, "POST_VARIANT_NOT_FOUND");

    const link = await createShortLink(
      deps.prisma,
      workspaceId,
      body.postId,
      body.variantId,
      body.targetUrl,
    );
    const baseUrl = process.env.SHORTLINK_BASE_URL ?? "http://localhost:3000";
    return c.json({
      code: link.code,
      url: shortLinkUrl(baseUrl, link.code),
      targetUrl: link.targetUrl,
    });
  });

  return app;
}
