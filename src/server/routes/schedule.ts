// /api/schedule/:postId routes (set / reschedule / cancel).
import { Hono, type Context } from "hono";
import { z } from "zod";
import { ApiError } from "../errors";
import { cancelSchedule, schedulePost } from "../posts";
import { parseDateParam, readJson, type AppEnv, type RouteDeps } from "./shared";

const scheduleSchema = z.object({ scheduledAt: z.string().min(1) });

async function applySchedule(c: Context<AppEnv>, deps: RouteDeps, postId: string) {
  const body = await readJson(c, scheduleSchema);
  const scheduledAt = parseDateParam(body.scheduledAt, "scheduledAt");
  if (!scheduledAt) throw new ApiError(400, "scheduledAt is required");
  return schedulePost(deps.prisma, deps.publisher, c.get("workspaceId"), postId, scheduledAt);
}

export function scheduleRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Set + reschedule share the idempotent schedulePost (queue-domain jobId semantics).
  app.post("/:postId", async (c) => {
    const post = await applySchedule(c, deps, c.req.param("postId"));
    return c.json({ post });
  });

  app.patch("/:postId", async (c) => {
    const post = await applySchedule(c, deps, c.req.param("postId"));
    return c.json({ post });
  });

  app.delete("/:postId", async (c) => {
    const post = await cancelSchedule(deps.prisma, deps.publisher, c.get("workspaceId"), c.req.param("postId"));
    return c.json({ post });
  });

  return app;
}
