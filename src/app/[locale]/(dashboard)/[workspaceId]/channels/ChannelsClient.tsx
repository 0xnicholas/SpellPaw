"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiClient } from "@/lib/client-api";

interface ChannelRow {
  slug: string;
  name: string;
  connected: boolean;
  connectedAt: string | null;
  accountName: string | null;
}

export function ChannelsClient({
  workspaceId,
  initialChannels,
}: {
  workspaceId: string;
  initialChannels: ChannelRow[];
}) {
  const api = createApiClient(workspaceId);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const res = await api.get<{ channels: ChannelRow[] }>("/api/channels");
      return res.channels;
    },
    initialData: initialChannels,
  });

  const connect = useMutation({
    mutationFn: async (slug: string) => {
      const { url } = await api.send<{ url: string }>(`/api/channels/${slug}/connect`, "POST");
      return url;
    },
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const disconnect = useMutation({
    mutationFn: async (slug: string) => {
      await api.send(`/api/channels/${slug}`, "DELETE");
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {channels.map((channel) => (
        <li key={channel.slug} className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  channel.connected ? "bg-green-500" : "bg-zinc-300"
                }`}
              />
              <span className="font-medium text-zinc-900">{channel.name}</span>
            </div>
            <p className="mt-0.5 pl-4 text-xs text-zinc-500">
              {channel.connected ? (
                <>
                  {channel.accountName ? (
                    <span className="mr-1 font-medium text-zinc-700">{channel.accountName}</span>
                  ) : null}
                  Connected{" "}
                  {channel.connectedAt ? new Date(channel.connectedAt).toLocaleDateString() : ""}
                </>
              ) : (
                "Not connected"
              )}
            </p>
          </div>
          {channel.connected ? (
            <button
              onClick={() => disconnect.mutate(channel.slug)}
              disabled={disconnect.isPending}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-40"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => connect.mutate(channel.slug)}
              disabled={connect.isPending}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              {connect.isPending && connect.variables === channel.slug ? "Connecting…" : "Connect"}
            </button>
          )}
        </li>
      ))}
      {error && (
        <li className="px-5 py-3 text-sm text-red-600">{error}</li>
      )}
    </ul>
  );
}
