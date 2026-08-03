import Link from "next/link";
import { signOut } from "@/lib/auth";

export function DashboardNav({ workspace }: { workspace: { id: string; name: string } }) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-lg">🐾</span>
            <span className="font-semibold text-zinc-900">SpellPaw</span>
          </div>
          <span className="text-sm text-zinc-500">{workspace.name}</span>
          <nav className="flex gap-4 text-sm">
            <Link
              href={`/${workspace.id}/content`}
              className="font-medium text-zinc-900 hover:text-zinc-600"
            >
              Content
            </Link>
            <Link
              href={`/${workspace.id}/channels`}
              className="font-medium text-zinc-500 hover:text-zinc-900"
            >
              Channels
            </Link>
          </nav>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="text-sm text-zinc-500 hover:text-zinc-900">Sign out</button>
        </form>
      </div>
    </header>
  );
}
