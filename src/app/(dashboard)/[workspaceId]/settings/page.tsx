import { SettingsClient } from "./SettingsClient";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return (
    <div>
      <h1 className="mb-5 text-xl font-semibold text-zinc-900">Settings</h1>
      <SettingsClient workspaceId={workspaceId} />
    </div>
  );
}
