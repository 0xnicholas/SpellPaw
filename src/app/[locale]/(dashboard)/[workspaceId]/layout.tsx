import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DashboardNav } from "@/components/DashboardNav";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string; locale: string }>;
}) {
  const { workspaceId } = await params;
  const locale = await getLocale();
  const session = await auth();
  if (!session?.user?.id) {
    redirect({ href: "/login", locale });
    return;
  }
  const userId = session.user.id;

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, accountId: userId },
  });
  if (!workspace) {
    redirect({ href: "/login", locale });
    return;
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <DashboardNav workspace={workspace} />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
