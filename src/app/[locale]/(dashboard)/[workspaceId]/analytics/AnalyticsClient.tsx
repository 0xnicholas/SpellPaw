"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { createApiClient } from "@/lib/client-api";

interface Dashboard {
  totalTouches: number;
  uniqueContacts: number;
  repeatViewers: number;
  stageDistribution: Array<{ stage: string; count: number }>;
  touchesByDay: Array<{ day: string; clicks: number }>;
  topPosts: Array<{ postId: string; title: string | null; clicks: number }>;
}

const STAGE_COLORS: Record<string, string> = {
  AWARE: "bg-zinc-300",
  ENGAGED: "bg-blue-400",
  ACTIVATED: "bg-emerald-400",
  LOYAL: "bg-violet-400",
  AT_RISK: "bg-amber-400",
  CHURNED: "bg-red-400",
};

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="flex h-24 flex-1 flex-col items-center justify-end gap-1">
      <span className="text-[10px] text-zinc-400">{value}</span>
      <div
        className={`w-full max-w-[28px] rounded-t ${color}`}
        style={{ height: max > 0 ? `${Math.max((value / max) * 80, 2)}px` : "2px" }}
      />
    </div>
  );
}

export function AnalyticsClient({ workspaceId }: { workspaceId: string }) {
  const api = createApiClient(workspaceId);
  const t = useTranslations("analytics");
  const { data, isLoading } = useQuery({
    queryKey: ["analytics-dashboard"],
    queryFn: () => api.get<Dashboard>("/api/analytics/dashboard"),
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="text-sm text-zinc-400">{t("loading")}</p>;

  const maxDay = Math.max(...(data?.touchesByDay ?? []).map((d) => d.clicks), 1);
  const maxStage = Math.max(...(data?.stageDistribution ?? []).map((s) => s.count), 1);

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t("totalTouches"), value: data?.totalTouches ?? 0 },
          { label: t("uniqueContacts"), value: data?.uniqueContacts ?? 0 },
          { label: t("repeatViewers"), value: data?.repeatViewers ?? 0 },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-xs text-zinc-500">{kpi.label}</p>
            <p className="mt-1 text-3xl font-semibold text-zinc-900">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Touches per day (14d) */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">{t("touches14d")}</h2>
          {(data?.touchesByDay ?? []).length === 0 ? (
            <p className="mt-6 text-sm text-zinc-400">{t("noClicks")}</p>
          ) : (
            <div className="mt-4 flex items-end gap-1">
              {data?.touchesByDay.map((d) => (
                <Bar key={d.day} value={d.clicks} max={maxDay} color="bg-blue-400" />
              ))}
            </div>
          )}
        </section>

        {/* Audience composition */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">{t("audienceStage")}</h2>
          {(data?.stageDistribution ?? []).length === 0 ? (
            <p className="mt-6 text-sm text-zinc-400">{t("noContacts")}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {data?.stageDistribution.map((s) => (
                <li key={s.stage} className="flex items-center gap-2 text-sm">
                  <span className={`h-2.5 w-2.5 rounded-full ${STAGE_COLORS[s.stage] ?? "bg-zinc-300"}`} />
                  <span className="w-24 text-zinc-600">{s.stage}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className={`h-full rounded-full ${STAGE_COLORS[s.stage] ?? "bg-zinc-300"}`}
                      style={{ width: `${(s.count / maxStage) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-zinc-400">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Top posts */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">{t("topPosts")}</h2>
        {(data?.topPosts ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">{t("noTopPosts")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {data?.topPosts.map((p) => (
              <li key={p.postId} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1 truncate text-zinc-700">{p.title ?? t("untitled")}</span>
                <span className="text-xs text-zinc-400">{t("clicks", { count: p.clicks })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
