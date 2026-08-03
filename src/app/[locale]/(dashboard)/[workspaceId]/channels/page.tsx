import { prisma } from "@/lib/db";
import { getTranslations } from "next-intl/server";
import { ChannelsClient } from "./ChannelsClient";

export default async function ChannelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { workspaceId } = await params;
  const { connected, error } = await searchParams;
  const t = await getTranslations("channels");

  const channels = await prisma.channel.findMany({
    orderBy: { slug: "asc" },
    include: { connections: { where: { workspaceId } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("subtitle")}</p>
      </div>

      {connected && (
        <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">
          Connected {connected} ✓
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          Connection failed — check the server console and try again.
        </p>
      )}

      <ChannelsClient
        workspaceId={workspaceId}
        initialChannels={channels.map((c) => ({
          slug: c.slug,
          name: c.name,
          connected: c.connections.length > 0,
          connectedAt: c.connections[0]?.connectedAt.toISOString() ?? null,
          accountName: c.connections[0]?.accountName ?? null,
        }))}
      />
    </div>
  );
}
