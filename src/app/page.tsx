import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureWorkspace } from "@/server/workspaces";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const workspace = await ensureWorkspace(prisma, session.user.id);
  redirect(`/${workspace.id}/content`);
}
