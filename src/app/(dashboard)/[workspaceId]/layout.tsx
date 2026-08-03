import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardNav } from "@/components/DashboardNav";
import { Providers } from "@/components/Providers";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, accountId: session.user.id },
  });
  if (!workspace) redirect("/login");

  return (
    <Providers>
      <div className="min-h-screen bg-zinc-50">
        <DashboardNav workspace={workspace} />
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </div>
    </Providers>
  );
}
