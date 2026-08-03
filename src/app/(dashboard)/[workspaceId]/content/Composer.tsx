"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useComposerStore, type ComposerChannel } from "@/stores/composer";
import { createApiClient } from "@/lib/client-api";
import { getChannelCharLimit } from "@/domain/post";

interface Props {
  workspaceId: string;
  channels: ComposerChannel[];
}

export function Composer({ workspaceId, channels }: Props) {
  const api = createApiClient(workspaceId);
  const queryClient = useQueryClient();
  const {
    globalDraft,
    touched,
    activeTab,
    contentFor,
    setGlobalDraft,
    setVariant,
    setActiveTab,
    reset,
  } = useComposerStore();

  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const aiMutation = useMutation({
    mutationFn: async ({ channelSlug }: { channelSlug: string }) => {
      // Rewrite the global source into a channel-appropriate variant (BYOK).
      const { content } = await api.send<{ content: string }>("/api/ai/generate", "POST", {
        text: globalDraft,
        channelSlug,
      });
      setVariant(channelSlug, content);
      setAiError(null);
    },
    onError: (err) => {
      setAiError(err instanceof Error ? err.message : String(err));
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["calendar"] });
    queryClient.invalidateQueries({ queryKey: ["posts"] });
  };

  const mutation = useMutation({
    mutationFn: async (action: "draft" | "schedule" | "publish") => {
      const variants = channels.map((c) => ({
        channelSlug: c.slug,
        content: contentFor(c.slug),
      }));
      const { post } = await api.send<{ post: { id: string } }>("/api/posts", "POST", {
        title: title || null,
        variants,
      });
      if (action === "schedule") {
        // datetime-local gives browser-local wall time; normalize to UTC ISO so
        // the server stores an unambiguous instant (FR-020: storage in UTC).
        const iso = new Date(scheduledAt).toISOString();
        await api.send(`/api/schedule/${post.id}`, "POST", { scheduledAt: iso });
      }
      if (action === "publish") {
        await api.send(`/api/posts/${post.id}/publish`, "POST");
      }
      return action;
    },
    onSuccess: (action) => {
      invalidate();
      reset();
      setTitle("");
      setScheduledAt("");
      setError(null);
      setNotice(
        action === "draft"
          ? "Draft saved."
          : action === "schedule"
            ? "Scheduled — the queue will publish it on time."
            : "Queued for publishing — it will appear shortly.",
      );
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : String(err));
      setNotice(null);
    },
  });

  const activeChannel = channels.find((c) => c.slug === activeTab) ?? null;
  const activeContent = activeChannel ? contentFor(activeChannel.slug) : globalDraft;
  const canSubmit = globalDraft.trim().length > 0;
  const charLimit = activeChannel ? getChannelCharLimit(activeChannel.slug) : null;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-5 py-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Post title (optional)"
          className="w-full text-lg font-medium text-zinc-900 placeholder-zinc-400 focus:outline-none"
        />
      </div>

      <div className="px-5 py-4">
        {/* Global source */}
        <div className="relative">
          <textarea
            value={globalDraft}
            onChange={(e) => setGlobalDraft(e.target.value)}
            rows={3}
            placeholder="Write your post…"
            className="w-full resize-none rounded-lg border border-zinc-200 p-3 text-sm focus:border-zinc-400 focus:outline-none"
          />
          {activeChannel && (
            <button
              onClick={() => aiMutation.mutate({ channelSlug: activeChannel.slug })}
              disabled={aiMutation.isPending || globalDraft.trim().length === 0}
              className="absolute bottom-2 right-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-zinc-50 disabled:opacity-40"
              title={`Rewrite the draft as a ${activeChannel.name} post using your model key`}
            >
              {aiMutation.isPending ? "✨ Rewriting…" : "✨ AI rewrite"}
            </button>
          )}
          {aiError && (
            <p className="mt-1 text-xs text-amber-700">
              {aiError === "MODEL_KEY_MISSING"
                ? "No model key configured — add one in Settings to use AI."
                : `AI rewrite failed: ${aiError}`}
            </p>
          )}
        </div>

        {/* Channel tabs */}
        <div className="mt-4 flex gap-2 border-b border-zinc-100">
          {channels.map((c) => {
            const content = contentFor(c.slug);
            const over = getChannelCharLimit(c.slug);
            const length = content.trim().length;
            const invalid = length === 0 || length > over;
            return (
              <button
                key={c.slug}
                onClick={() => setActiveTab(c.slug)}
                className={`px-3 py-2 text-sm font-medium ${
                  activeTab === c.slug
                    ? "border-b-2 border-zinc-900 text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-800"
                }`}
              >
                {c.name}
                {!c.connected && <span className="ml-1.5 text-xs text-amber-600">●</span>}
                {touched[c.slug] && <span className="ml-1.5 text-xs text-zinc-400">edited</span>}
                {invalid && length > 0 && <span className="ml-1.5 text-xs text-red-500">!</span>}
              </button>
            );
          })}
        </div>

        {/* Variant editor for the active channel */}
        {activeChannel && (
          <div className="mt-3">
            <textarea
              value={activeContent}
              onChange={(e) => setVariant(activeChannel.slug, e.target.value)}
              rows={3}
              placeholder={`${activeChannel.name} variant — starts from your draft, edit freely`}
              className="w-full resize-none rounded-lg border border-zinc-200 p-3 text-sm focus:border-zinc-400 focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
              <span>{charLimit ? `${activeContent.trim().length}/${charLimit}` : "—"}</span>
              {activeChannel.connected ? (
                <span className="text-green-600">Connected</span>
              ) : (
                <span className="text-amber-600">Not connected — publishing will fail for this channel</span>
              )}
            </div>
          </div>
        )}

        {/* Publish bar */}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4">
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
            aria-label="Schedule time"
          />
          <button
            onClick={() => mutation.mutate("draft")}
            disabled={!canSubmit || mutation.isPending}
            className="rounded-lg border border-zinc-300 px-4 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
          >
            Save Draft
          </button>
          <button
            onClick={() => mutation.mutate("schedule")}
            disabled={!canSubmit || !scheduledAt || mutation.isPending}
            className="rounded-lg bg-zinc-200 px-4 py-1.5 text-sm font-medium hover:bg-zinc-300 disabled:opacity-40"
          >
            Schedule
          </button>
          <button
            onClick={() => mutation.mutate("publish")}
            disabled={!canSubmit || mutation.isPending}
            className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {mutation.isPending ? "Working…" : "Publish"}
          </button>
          {notice && <span className="text-sm text-green-700">{notice}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>
    </section>
  );
}
