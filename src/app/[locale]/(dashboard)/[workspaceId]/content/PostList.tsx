"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { createApiClient } from "@/lib/client-api";

export interface PostSummary {
  id: string;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED";
  title: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  variants: Array<{
    id: string;
    content: string;
    charCount: number;
    publishState: "DRAFT" | "PUBLISHED" | "FAILED";
    errorMessage: string | null;
    queueState?: "queued" | "posting" | "scheduled" | null;
    channel: { slug: string; name: string };
  }>;
}

const STATUS_STYLE: Record<PostSummary["status"], string> = {
  DRAFT: "bg-zinc-100 text-zinc-600",
  SCHEDULED: "bg-blue-50 text-blue-700",
  PUBLISHED: "bg-green-50 text-green-700",
};

const QUEUE_LABEL: Record<NonNullable<PostSummary["variants"][number]["queueState"]>, string> = {
  queued: "queued",
  posting: "posting…",
  scheduled: "delayed",
};

export function PostList({
  workspaceId,
  initialPosts,
}: {
  workspaceId: string;
  initialPosts: PostSummary[];
}) {
  const api = createApiClient(workspaceId);
  const queryClient = useQueryClient();
  const t = useTranslations("postlist");
  // Short links (ADR-0009): per-variant creation state.
  const [linkTarget, setLinkTarget] = useState<{ postId: string; variantId: string } | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const shorten = useMutation({
    mutationFn: async ({ postId, variantId, targetUrl }: { postId: string; variantId: string; targetUrl: string }) => {
      const res = await api.send<{ code: string; url: string }>("/api/shorten", "POST", {
        postId,
        variantId,
        targetUrl,
      });
      return res;
    },
    onSuccess: (res, vars) => {
      setLinks((prev) => ({ ...prev, [vars.variantId]: res.url }));
      setLinkTarget(null);
      setLinkUrl("");
      navigator.clipboard.writeText(res.url).catch(() => {});
      setCopied(vars.variantId);
      setTimeout(() => setCopied(null), 1500);
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });
  const { data: posts } = useQuery({
    queryKey: ["posts"],
    queryFn: async () => {
      const res = await api.get<{ posts: PostSummary[] }>("/api/posts");
      return res.posts;
    },
    initialData: initialPosts,
    // Poll while any variant is mid-flight through the queue.
    refetchInterval: (query) => {
      const posts = query.state.data ?? [];
      const busy = posts.some((p) => p.variants.some((v) => v.queueState));
      return busy ? 2500 : false;
    },
  });

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="font-semibold text-zinc-900">{t("title")}</h2>
      </div>
      {posts.length === 0 ? (
        <p className="px-5 py-8 text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {posts.map((post) => (
            <li key={post.id} className="px-5 py-3">
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[post.status]}`}>
                  {post.status}
                </span>
                <span className="text-sm font-medium text-zinc-900">
                  {post.title ?? post.variants[0]?.content.slice(0, 60) ?? t("untitled")}
                </span>
                <span className="ml-auto text-xs text-zinc-400">
                  {new Date(post.createdAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500">
                {post.variants.map((v) => (
                  <span key={v.id} className="inline-flex items-center gap-1">
                    <span className="font-medium">{v.channel.name}</span>
                    {v.queueState ? (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          v.queueState === "posting"
                            ? "animate-pulse bg-blue-50 text-blue-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {QUEUE_LABEL[v.queueState]}
                      </span>
                    ) : v.publishState === "FAILED" ? (
                      <span className="text-red-600" title={v.errorMessage ?? "failed"}>
                        {t("failed")}{v.errorMessage ? `: ${v.errorMessage}` : ""}
                      </span>
                    ) : (
                      <span>
                        {v.charCount} {t("chars")} · {v.publishState}
                      </span>
                    )}
                    {links[v.id] ? (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(links[v.id]).catch(() => {});
                          setCopied(v.id);
                          setTimeout(() => setCopied(null), 1500);
                        }}
                        className="font-mono text-[11px] text-zinc-400 underline-offset-2 hover:text-zinc-700 hover:underline"
                        title={t("copyLink")}
                      >
                        {copied === v.id ? t("copied") : links[v.id].replace(/^https?:\/\//, "")}
                      </button>
                    ) : (
                      <button
                        onClick={() => setLinkTarget({ postId: post.id, variantId: v.id })}
                        className="text-[11px] text-zinc-400 hover:text-zinc-700"
                        title={t("createLink")}
                      >
                        🔗 link
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {linkTarget?.postId === post.id && (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (linkUrl.trim()) shorten.mutate({ ...linkTarget, targetUrl: linkUrl.trim() });
                  }}
                >
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder={t("destinationPlaceholder")}
                    className="flex-1 rounded-lg border border-zinc-300 px-3 py-1 text-xs focus:border-zinc-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={shorten.isPending || linkUrl.trim().length === 0}
                    className="rounded-lg bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {shorten.isPending ? t("creating") : t("createAndCopy")}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
