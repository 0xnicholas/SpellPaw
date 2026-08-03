"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiClient } from "@/lib/client-api";

interface Props {
  workspaceId: string;
}

interface ModelKeyView {
  id: string;
  provider: "openai" | "anthropic";
  keyPreview: string;
  isActive: boolean;
  lastChecked: string | null;
  createdAt: string;
}

interface ApiTokenView {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export function SettingsClient({ workspaceId }: Props) {
  const api = createApiClient(workspaceId);
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [apiKey, setApiKey] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["model-keys"],
    queryFn: () => api.get<{ keys: ModelKeyView[] }>("/api/settings/model-keys"),
  });
  const tokensQuery = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => api.get<{ tokens: ApiTokenView[] }>("/api/settings/api-tokens"),
  });

  const addKey = useMutation({
    mutationFn: async () => {
      const { key } = await api.send<{ key: ModelKeyView }>("/api/settings/model-keys", "POST", {
        provider,
        apiKey,
      });
      return key;
    },
    onSuccess: () => {
      setApiKey("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["model-keys"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const deleteKey = useMutation({
    mutationFn: (id: string) => api.send(`/api/settings/model-keys/${id}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["model-keys"] }),
  });

  const mintToken = useMutation({
    mutationFn: async () => {
      const { token } = await api.send<{ token: string }>("/api/settings/api-tokens", "POST", {
        name: tokenName,
      });
      return token;
    },
    onSuccess: (token) => {
      setMintedToken(token); // shown exactly once
      setTokenName("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const revokeToken = useMutation({
    mutationFn: (id: string) => api.send(`/api/settings/api-tokens/${id}`, "DELETE"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-tokens"] }),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {error && (
        <div className="lg:col-span-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Model keys (BYOK — ADR-0005) */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">Model keys</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Your own OpenAI/Anthropic keys power AI features. Keys are encrypted at rest; only a
          preview is shown.
        </p>

        <div className="mt-4 flex gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as "openai" | "anthropic")}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={`sk-… (${provider})`}
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
          />
          <button
            onClick={() => addKey.mutate()}
            disabled={addKey.isPending || apiKey.trim().length < 10}
            className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {addKey.isPending ? "Saving…" : "Add"}
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {(keysQuery.data?.keys ?? []).map((k) => (
            <li key={k.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-zinc-900 capitalize">{k.provider}</span>
                <span className="ml-2 font-mono text-xs text-zinc-500">{k.keyPreview}</span>
                {!k.isActive && <span className="ml-2 text-xs text-amber-600">inactive</span>}
              </div>
              <button
                onClick={() => deleteKey.mutate(k.id)}
                className="text-xs text-zinc-400 hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
          {(keysQuery.data?.keys ?? []).length === 0 && (
            <li className="text-sm text-zinc-400">No keys yet — add one to enable AI rewrite.</li>
          )}
        </ul>
      </section>

      {/* API tokens (bearer auth for MCP clients) */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">API tokens</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Use a token to connect MCP clients (Claude Desktop, Cursor, custom agents) to this
          workspace&apos;s API.
        </p>

        <div className="mt-4 flex gap-2">
          <input
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="e.g. claude desktop"
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
          />
          <button
            onClick={() => mintToken.mutate()}
            disabled={mintToken.isPending || tokenName.trim().length === 0}
            className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {mintToken.isPending ? "Minting…" : "Create"}
          </button>
        </div>

        {mintedToken && (
          <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm">
            <p className="text-green-800">
              Token created — <span className="font-semibold">copy it now</span>, it won&apos;t be
              shown again.
            </p>
            <code className="mt-1 block break-all font-mono text-xs text-zinc-700">{mintedToken}</code>
          </div>
        )}

        <ul className="mt-4 space-y-2">
          {(tokensQuery.data?.tokens ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-zinc-900">{t.name}</span>
                <span className="ml-2 text-xs text-zinc-500">
                  {t.lastUsedAt ? `last used ${new Date(t.lastUsedAt).toLocaleString()}` : "never used"}
                </span>
              </div>
              <button
                onClick={() => revokeToken.mutate(t.id)}
                className="text-xs text-zinc-400 hover:text-red-600"
              >
                Revoke
              </button>
            </li>
          ))}
          {(tokensQuery.data?.tokens ?? []).length === 0 && (
            <li className="text-sm text-zinc-400">No tokens yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
