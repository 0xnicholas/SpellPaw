// Public landing (M5) — lifecycle intelligence for AI-native builders
// (ADR-0012). Served at /en /zh when signed out; signed-in users are
// redirected to their workspace by page.tsx.
import { Link } from "@/i18n/navigation";
import { getTranslations, getLocale } from "next-intl/server";

export default async function Landing() {
  const t = await getTranslations("landing");
  const locale = await getLocale();

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">SpellPaw</span>
        <nav className="flex items-center gap-4 text-sm">
          <a href="#features" className="text-zinc-500 hover:text-zinc-900">
            {t("navFeatures")}
          </a>
          <a href="#stories" className="text-zinc-500 hover:text-zinc-900">
            {t("navStories")}
          </a>
          <Link
            href="/login" locale={locale}
            className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            {t("cta")}
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-20 pt-16 text-center">
        <p className="mx-auto mb-4 inline-block rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500">
          {t("badge")}
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          {t("heroTitle")}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-500">{t("heroBody")}</p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/login" locale={locale}
            className="rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            {t("cta")}
          </Link>
          <a
            href="https://github.com/0xnicholas/SpellPaw"
            className="rounded-lg border border-zinc-300 px-6 py-2.5 text-sm font-medium hover:bg-zinc-50"
          >
            {t("github")}
          </a>
        </div>
      </section>

      <section id="features" className="border-t border-zinc-100 bg-zinc-50/60 py-16">
        <div className="mx-auto grid max-w-5xl gap-6 px-6 sm:grid-cols-3">
          {["f1", "f2", "f3"].map((k) => (
            <div key={k} className="rounded-xl border border-zinc-200 bg-white p-6">
              <h3 className="font-semibold">{t(`${k}.title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">{t(`${k}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="stories" className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-bold tracking-tight">{t("storiesTitle")}</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {["s1", "s2", "s3"].map((k) => (
            <figure key={k} className="rounded-xl border border-zinc-200 p-6">
              <blockquote className="text-sm leading-relaxed text-zinc-600">
                {t(`${k}.quote`)}
              </blockquote>
              <figcaption className="mt-4 text-xs font-medium text-zinc-900">
                {t(`${k}.who`)}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="border-t border-zinc-100 bg-zinc-900 py-14 text-center text-white">
        <h2 className="text-2xl font-bold tracking-tight">{t("finalTitle")}</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-300">{t("finalBody")}</p>
        <Link
          href="/login" locale={locale}
          className="mt-6 inline-block rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
        >
          {t("cta")}
        </Link>
      </section>

      <footer className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6 text-xs text-zinc-400">
        <span>SpellPaw — {t("footerTag")}</span>
        <span>
          <a href="https://github.com/0xnicholas/SpellPaw" className="hover:text-zinc-700">
            GitHub
          </a>{" "}
          · {t("selfHosted")}
        </span>
      </footer>
    </div>
  );
}
