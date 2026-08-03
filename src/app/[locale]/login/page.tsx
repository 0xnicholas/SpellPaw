import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in — SpellPaw" };

export default async function LoginPage() {
  const t = await getTranslations("login");
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <div className="text-2xl">🐾</div>
          <h1 className="mt-2 text-xl font-semibold text-zinc-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t("subtitle")}</p>
        </div>
        <LoginForm devMode={process.env.AUTH_EMAIL_DEV_MODE === "true"} />
      </div>
    </main>
  );
}
