"use client";

import { useQuery } from "@tanstack/react-query";
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
        <h2 className="font-semibold text-zinc-900">Recent posts</h2>
      </div>
      {posts.length === 0 ? (
        <p className="px-5 py-8 text-sm text-zinc-500">
          No posts yet — write something in the composer above.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {posts.map((post) => (
            <li key={post.id} className="px-5 py-3">
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[post.status]}`}>
                  {post.status}
                </span>
                <span className="text-sm font-medium text-zinc-900">
                  {post.title ?? post.variants[0]?.content.slice(0, 60) ?? "Untitled"}
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
                        failed{v.errorMessage ? `: ${v.errorMessage}` : ""}
                      </span>
                    ) : (
                      <span>
                        {v.charCount} chars · {v.publishState}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
