import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureWorkspace } from "@/server/workspaces";
import Landing from "./(public)/landing/LandingPage";

export default async function Home() {
  const locale = await getLocale();
  const session = await auth();
  if (session?.user?.id) {
    const workspace = await ensureWorkspace(prisma, session.user.id);
    redirect({ href: `/${workspace.id}/content`, locale });
    return;
  }
  // Signed out — the public landing page (M5, English-first narrative).
  return <Landing />;
}
