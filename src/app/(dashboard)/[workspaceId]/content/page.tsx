import { prisma } from "@/lib/db";
import { Composer } from "./Composer";
import { CalendarPanel } from "./CalendarPanel";
import { PostList } from "./PostList";

export default async function ContentPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  const [posts, channels] = await Promise.all([
    prisma.post.findMany({
      where: { workspaceId },
      include: { variants: { include: { channel: true }, orderBy: { id: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.channel.findMany({
      orderBy: { slug: "asc" },
      include: { connections: { where: { workspaceId } } },
    }),
  ]);

  const initialPosts = posts.map((p) => ({
    ...p,
    scheduledAt: p.scheduledAt ? p.scheduledAt.toISOString() : null,
    publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Content</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Create once, publish everywhere. Your customer graph starts with every click.
        </p>
      </div>

      <Composer
        workspaceId={workspaceId}
        channels={channels.map((c) => ({
          slug: c.slug,
          name: c.name,
          connected: c.connections.length > 0,
        }))}
      />

      <CalendarPanel workspaceId={workspaceId} />
      <PostList workspaceId={workspaceId} initialPosts={initialPosts} />
    </div>
  );
}
