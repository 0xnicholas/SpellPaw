import { getTranslations } from "next-intl/server";
import { SettingsClient } from "./SettingsClient";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const t = await getTranslations("settings");
  return (
    <div>
      <h1 className="mb-5 text-xl font-semibold text-zinc-900">{t("title")}</h1>
      <SettingsClient workspaceId={workspaceId} />
    </div>
  );
}
