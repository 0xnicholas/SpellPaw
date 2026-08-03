"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createApiClient } from "@/lib/client-api";
import { DAY_MS, localDateKey } from "@/lib/time";

interface CalendarPost {
  id: string;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED";
  title: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  variants: Array<{
    id: string;
    content: string;
    publishState: string;
    errorMessage: string | null;
    channel: { slug: string; name: string };
  }>;
}

interface CalendarResponse {
  start: string;
  days: number;
  posts: CalendarPost[];
}

function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day); // Monday first
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

const DAYS_7 = 7 * DAY_MS;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarPanel({ workspaceId }: { workspaceId: string }) {
  const api = createApiClient(workspaceId);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

  const { data, isLoading } = useQuery({
    queryKey: ["calendar", weekStart.toISOString()],
    queryFn: () => api.get<CalendarResponse>(`/api/calendar?start=${weekStart.toISOString()}&days=7`),
  });

  const postsByDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const post of data?.posts ?? []) {
      const iso = post.status === "SCHEDULED" ? post.scheduledAt : post.publishedAt;
      if (!iso) continue;
      const key = localDateKey(iso);
      map.set(key, [...(map.get(key) ?? []), post]);
    }
    return map;
  }, [data]);

  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS));
  const today = localDateKey(new Date().toISOString());

  const timeLabel = (post: CalendarPost) => {
    const iso = post.status === "SCHEDULED" ? post.scheduledAt : post.publishedAt;
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
        <h2 className="font-semibold text-zinc-900">Calendar</h2>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setWeekStart((d) => new Date(d.getTime() - DAYS_7))}
            className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
          >
            ←
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart((d) => new Date(d.getTime() + DAYS_7))}
            className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
          >
            →
          </button>
          <span className="ml-1 text-zinc-500">
            {days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} –{" "}
            {days[6].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </div>
      </div>

      {isLoading ? (
        <p className="px-5 py-8 text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-7 divide-x divide-zinc-100">
          {days.map((day) => {
            const key = localDateKey(day.toISOString());
            const posts = postsByDay.get(key) ?? [];
            return (
              <div key={key} className="min-h-28 px-2 py-2">
                <div className={`text-xs font-medium ${key === today ? "text-zinc-900" : "text-zinc-400"}`}>
                  {WEEKDAYS[day.getUTCDay() === 0 ? 6 : day.getUTCDay() - 1]}{" "}
                  {day.getUTCDate()}
                </div>
                <div className="mt-1 space-y-1">
                  {posts.map((post) => (
                    <div
                      key={post.id}
                      className={`rounded-md px-2 py-1 text-[11px] leading-tight ${
                        post.status === "PUBLISHED"
                          ? "bg-green-50 text-green-800"
                          : "bg-blue-50 text-blue-800"
                      }`}
                    >
                      <div className="font-medium">{post.title ?? post.variants[0]?.content.slice(0, 28) ?? "Untitled"}</div>
                      <div className="opacity-70">
                        {post.variants.map((v) => v.channel.slug).join(", ")} · {timeLabel(post)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
