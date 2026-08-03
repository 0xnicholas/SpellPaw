import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in — SpellPaw" };

export default async function LoginPage() {
  const t = await getTranslations("login");
  const locale = (await getLocale()) as "en" | "zh";

  // Already signed in? The magic-link callback lands back on this page (its
  // own callbackUrl) — bounce straight into the workspace instead of showing
  // the form again.
  const session = await auth();
  if (session?.user?.id) {
    redirect({ href: "/", locale });
  }

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
