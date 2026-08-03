// /api/variants/:id routes.
import { Hono } from "hono";
import { z } from "zod";
import { updateVariant } from "../posts";
import { readJson, type AppEnv, type RouteDeps } from "./shared";

const variantUpdateSchema = z.object({ content: z.string() });

export function variantsRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.patch("/:id", async (c) => {
    const body = await readJson(c, variantUpdateSchema);
    const variant = await updateVariant(deps.prisma, c.get("workspaceId"), c.req.param("id"), body.content);
    return c.json({ variant });
  });

  return app;
}
