import { getTranslations } from "next-intl/server";
import { AnalyticsClient } from "./AnalyticsClient";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const t = await getTranslations("analytics");
  return (
    <div>
      <h1 className="mb-5 text-xl font-semibold text-zinc-900">{t("title")}</h1>
      <AnalyticsClient workspaceId={workspaceId} />
    </div>
  );
}
