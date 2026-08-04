import { getTranslations } from "next-intl/server";
import { InboxClient } from "./InboxClient";

export default async function InboxPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const t = await getTranslations("inbox");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("subtitle")}</p>
      </div>
      <InboxClient workspaceId={workspaceId} />
    </div>
  );
}
