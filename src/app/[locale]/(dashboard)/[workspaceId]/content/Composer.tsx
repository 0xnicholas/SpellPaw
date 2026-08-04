"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useComposerStore, type ComposerChannel } from "@/stores/composer";
import { createApiClient } from "@/lib/client-api";
import { getChannelCharLimit } from "@/domain/post";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
  const t = useTranslations("composer");

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
          ? t("draftSaved")
          : action === "schedule"
            ? t("scheduledNotice")
            : t("queuedNotice"),
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
    <Card>
      <CardHeader className="border-b">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("titlePlaceholder")}
          className="h-auto border-0 bg-transparent px-0 text-lg font-medium shadow-none focus-visible:ring-0"
        />
      </CardHeader>

      <CardContent>
        {/* Global source */}
        <div className="relative">
          <Textarea
            value={globalDraft}
            onChange={(e) => setGlobalDraft(e.target.value)}
            rows={3}
            placeholder={t("writePlaceholder")}
            className="resize-none"
          />
          {activeChannel && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => aiMutation.mutate({ channelSlug: activeChannel.slug })}
              disabled={aiMutation.isPending || globalDraft.trim().length === 0}
              className="absolute bottom-2 right-2"
              title={`Rewrite the draft as a ${activeChannel.name} post using your model key`}
            >
              {aiMutation.isPending ? "✨ Rewriting…" : "✨ AI rewrite"}
            </Button>
          )}
          {aiError && (
            <p className="mt-1 text-xs text-amber-700">
              {aiError === "MODEL_KEY_MISSING"
                ? t("aiNoKey")
                : t("aiFailed", { message: aiError })}
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
            <Textarea
              value={activeContent}
              onChange={(e) => setVariant(activeChannel.slug, e.target.value)}
              rows={3}
              placeholder={t("variantPlaceholder", { name: activeChannel.name })}
              className="resize-none"
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
      </CardContent>

      {/* Publish bar */}
      <CardFooter className="flex flex-wrap items-center gap-3">
        <Input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="w-auto"
          aria-label="Schedule time"
        />
        <Button
          variant="outline"
          onClick={() => mutation.mutate("draft")}
          disabled={!canSubmit || mutation.isPending}
        >
          Save Draft
        </Button>
        <Button
          variant="secondary"
          onClick={() => mutation.mutate("schedule")}
          disabled={!canSubmit || !scheduledAt || mutation.isPending}
        >
          Schedule
        </Button>
        <Button
          onClick={() => mutation.mutate("publish")}
          disabled={!canSubmit || mutation.isPending}
        >
          {mutation.isPending ? t("working") : t("publish")}
        </Button>
        {notice && <span className="text-sm text-green-700">{notice}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </CardFooter>
    </Card>
  );
}
