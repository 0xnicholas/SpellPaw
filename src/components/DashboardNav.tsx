import { Link } from "@/i18n/navigation";
import { signOut } from "@/lib/auth";
import { getTranslations } from "next-intl/server";

export async function DashboardNav({ workspace }: { workspace: { id: string; name: string } }) {
  const t = await getTranslations("nav");
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-lg">🐾</span>
            <span className="font-semibold text-zinc-900">{t("brand")}</span>
          </div>
          <span className="text-sm text-zinc-500">{workspace.name}</span>
          <nav className="flex gap-4 text-sm">
            <Link
              href={`/${workspace.id}/content`}
              className="font-medium text-zinc-900 hover:text-zinc-600"
            >
              {t("content")}
            </Link>
            <Link
              href={`/${workspace.id}/analytics`}
              className="font-medium text-zinc-500 hover:text-zinc-900"
            >
              {t("analytics")}
            </Link>
            <Link
              href={`/${workspace.id}/channels`}
              className="font-medium text-zinc-500 hover:text-zinc-900"
            >
              {t("channels")}
            </Link>
            <Link
              href={`/${workspace.id}/settings`}
              className="font-medium text-zinc-500 hover:text-zinc-900"
            >
              {t("settings")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-zinc-400">
            <Link
              href={`/${workspace.id}/content`}
              locale="en"
              className="hover:text-zinc-700"
            >
              EN
            </Link>
            {" / "}
            <Link
              href={`/${workspace.id}/content`}
              locale="zh"
              className="hover:text-zinc-700"
            >
              中
            </Link>
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="text-sm text-zinc-500 hover:text-zinc-900">{t("signOut")}</button>
          </form>
        </div>
      </div>
    </header>
  );
}
