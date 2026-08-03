// /api/calendar routes.
import { Hono } from "hono";
import { ApiError } from "../errors";
import { getCalendarEvents } from "../posts";
import { DAY_MS, startOfDayUtc } from "@/lib/time";
import { clampDays, enrichQueueStates, parseDateParam, type AppEnv, type RouteDeps } from "./shared";

export function calendarRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const start = parseDateParam(c.req.query("start"), "start") ?? startOfDayUtc(new Date());
    const days = clampDays(Number(c.req.query("days")) || 7);
    const end = new Date(start.getTime() + days * DAY_MS);
    const view = c.req.query("view") ?? "week";
    if (view !== "week" && view !== "month") {
      throw new ApiError(400, "view must be 'week' or 'month'");
    }
    const channels = c.req.query("channels")?.split(",").filter(Boolean);
    const posts = await getCalendarEvents(deps.prisma, c.get("workspaceId"), start, end, channels);
    await enrichQueueStates(deps, posts);
    return c.json({ start: start.toISOString(), days, view, posts });
  });

  return app;
}
