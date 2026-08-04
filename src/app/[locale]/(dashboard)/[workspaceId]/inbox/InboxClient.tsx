"use client";

// M6 Inbox (ADR-0013) — three-column surface:
//   [thread list] [message thread + reply composer] [contact sidebar]
// Polls every 3s while open so simulated comments (30–90s after publish) and
// reply delivery states (PENDING → SENT/FAILED) show up without a refresh.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createApiClient } from "@/lib/client-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Thread {
  threadId: string;
  contactId: string;
  channelSlug: string;
  channelName: string;
  contact: {
    name: string | null;
    handle: string | null;
    sourceChannel: string | null;
    lifecycleStage: string;
    type: string;
  };
  lastMessage: { content: string; direction: string; timestamp: string };
  messageCount: number;
  unreadCount: number;
  lastReadAt: string | null;
}

interface ThreadDetail {
  threadId: string;
  contact: { name: string | null; handle: string | null; lifecycleStage: string; type: string };
  channelSlug: string;
  channelName: string;
  messages: Array<{
    id: string;
    content: string;
    direction: "INBOUND" | "OUTBOUND";
    deliveryState: "PENDING" | "SENT" | "FAILED";
    errorMessage: string | null;
    timestamp: string;
  }>;
}

interface TimelineRow {
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

const STAGE_COLORS: Record<string, string> = {
  AWARE: "bg-zinc-200 text-zinc-700",
  ENGAGED: "bg-blue-100 text-blue-700",
  ACTIVATED: "bg-emerald-100 text-emerald-700",
  LOYAL: "bg-violet-100 text-violet-700",
  AT_RISK: "bg-amber-100 text-amber-700",
  CHURNED: "bg-red-100 text-red-700",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function InboxClient({ workspaceId }: { workspaceId: string }) {
  const api = createApiClient(workspaceId);
  const t = useTranslations("inbox");
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const threadsQuery = useQuery({
    queryKey: ["inbox", "threads"],
    queryFn: () => api.get<{ threads: Thread[] }>("/api/inbox/conversations"),
    refetchInterval: 3000,
  });

  const selectedThread = useMemo(
    () => threadsQuery.data?.threads.find((th) => th.threadId === selected) ?? null,
    [threadsQuery.data, selected],
  );

  const detailQuery = useQuery({
    queryKey: ["inbox", "thread", selected],
    queryFn: () => api.get<ThreadDetail>(`/api/inbox/conversations/${encodeURIComponent(selected!)}`),
    enabled: !!selected,
    refetchInterval: 2000,
  });

  const timelineQuery = useQuery({
    queryKey: ["inbox", "timeline", selectedThread?.contactId],
    queryFn: () => api.get<{ timeline: TimelineRow[] }>(`/api/contacts/${selectedThread!.contactId}/timeline`),
    enabled: !!selectedThread,
    refetchInterval: 10_000,
  });

  const replyMutation = useMutation({
    mutationFn: async (content: string) =>
      api.send(`/api/inbox/conversations/${encodeURIComponent(selected!)}/reply`, "POST", { content }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["inbox", "threads"] });
      queryClient.invalidateQueries({ queryKey: ["inbox", "thread", selected] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const readMutation = useMutation({
    mutationFn: () => api.send(`/api/inbox/conversations/${encodeURIComponent(selected!)}/read`, "POST"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inbox", "threads"] }),
  });

  const activateMutation = useMutation({
    mutationFn: () => api.send(`/api/contacts/${selectedThread!.contactId}/activate`, "POST"),
    onSuccess: () => {
      toast.success(t("activated"));
      queryClient.invalidateQueries({ queryKey: ["inbox", "threads"] });
      queryClient.invalidateQueries({ queryKey: ["inbox", "thread", selected] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Mark the thread read the moment it's opened.
  useEffect(() => {
    if (selected && selectedThread?.unreadCount) {
      readMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const sendReply = useCallback(() => {
    const content = draft.trim();
    if (!content || !selected || replyMutation.isPending) return;
    replyMutation.mutate(content);
  }, [draft, selected, replyMutation]);

  const threads = threadsQuery.data?.threads ?? [];

  return (
    <div className="grid h-[calc(100vh-11rem)] grid-cols-[320px_1fr_280px] overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {/* --- Thread list --- */}
      <aside className="overflow-y-auto border-r border-zinc-200">
        {threads.length === 0 && (
          <p className="p-4 text-sm text-zinc-400">{t("empty")}</p>
        )}
        {threads.map((th) => (
          <button
            key={th.threadId}
            onClick={() => setSelected(th.threadId)}
            className={`flex w-full flex-col gap-1 border-b border-zinc-100 px-4 py-3 text-left transition-colors hover:bg-zinc-50 ${
              selected === th.threadId ? "bg-blue-50/60" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                {th.contact.name ?? th.contact.handle ?? th.contactId.slice(0, 8)}
                {th.unreadCount > 0 && (
                  <span className="h-2 w-2 rounded-full bg-blue-500" title={t("unread")} />
                )}
              </span>
              <span className="text-[11px] text-zinc-400">{timeAgo(th.lastMessage.timestamp)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-zinc-500">
                {th.lastMessage.direction === "OUTBOUND" && (
                  <span className="text-zinc-400">{t("you")} · </span>
                )}
                {th.lastMessage.content}
              </span>
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {th.channelName}
              </Badge>
            </div>
          </button>
        ))}
      </aside>

      {/* --- Thread --- */}
      <section className="flex min-w-0 flex-col">
        {!selectedThread || !detailQuery.data ? (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
            {t("openThread")}
          </div>
        ) : (
          <>
            <div className="border-b border-zinc-200 px-4 py-2 text-sm text-zinc-500">
              {selectedThread.contact.name ?? selectedThread.contact.handle ?? ""}{" "}
              <span className="text-zinc-400">· {selectedThread.channelName}</span>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {detailQuery.data.messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.direction === "INBOUND" ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                      m.direction === "INBOUND"
                        ? "rounded-bl-sm bg-zinc-100 text-zinc-900"
                        : "rounded-br-sm bg-blue-600 text-white"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    <div
                      className={`mt-1 flex items-center gap-2 text-[10px] ${
                        m.direction === "INBOUND" ? "text-zinc-400" : "text-blue-200"
                      }`}
                    >
                      {timeAgo(m.timestamp)}
                      {m.direction === "OUTBOUND" && m.deliveryState !== "SENT" && (
                        <span>
                          {m.deliveryState === "PENDING" ? t("sending") : t("failed")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-zinc-200 p-3">
              <Textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("replyPlaceholder")}
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" onClick={sendReply} disabled={!draft.trim() || replyMutation.isPending}>
                  {replyMutation.isPending ? t("sending") : t("send")}
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* --- Contact sidebar --- */}
      <aside className="overflow-y-auto border-l border-zinc-200">
        {selectedThread && (
          <div className="space-y-4 p-4">
            <div>
              <p className="text-sm font-semibold text-zinc-900">
                {selectedThread.contact.name ?? selectedThread.contact.handle ?? "—"}
              </p>
              {selectedThread.contact.handle && (
                <p className="text-xs text-zinc-500">@{selectedThread.contact.handle}</p>
              )}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">{t("lifecycle")}</span>
                <Badge className={STAGE_COLORS[selectedThread.contact.lifecycleStage] ?? ""}>
                  {selectedThread.contact.lifecycleStage}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">{t("type")}</span>
                <span className="font-medium text-zinc-700">{selectedThread.contact.type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">{t("channel")}</span>
                <span className="font-medium text-zinc-700">{selectedThread.channelName}</span>
              </div>
            </div>

            {selectedThread.contact.lifecycleStage !== "ACTIVATED" && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => activateMutation.mutate()}
                disabled={activateMutation.isPending}
              >
                {t("activate")}
              </Button>
            )}

            <div>
              <p className="mb-2 text-xs font-medium text-zinc-500">{t("activity")}</p>
              <ul className="space-y-1.5">
                {(timelineQuery.data?.timeline ?? []).map((row, i) => (
                  <li key={i} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-[10px] text-zinc-400">
                      {row.type.replace("_", " ")}
                    </span>
                    <span className="text-zinc-500">{timeAgo(row.timestamp)}</span>
                  </li>
                ))}
                {(timelineQuery.data?.timeline ?? []).length === 0 && (
                  <li className="text-xs text-zinc-400">{t("noActivity")}</li>
                )}
              </ul>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
