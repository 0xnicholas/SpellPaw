import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureWorkspace } from "@/server/workspaces";

export default async function Home() {
  const locale = await getLocale();
  const session = await auth();
  if (!session?.user?.id) {
    redirect({ href: "/login", locale });
    return;
  }
  const workspace = await ensureWorkspace(prisma, session.user.id);
  redirect({ href: `/${workspace.id}/content`, locale });
}
