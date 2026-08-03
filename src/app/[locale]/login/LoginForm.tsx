"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";

export function LoginForm({ devMode }: { devMode: boolean }) {
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    const res = await signIn("email", { email, redirect: false });
    setStatus(res?.ok === false ? "error" : "sent");
  }

  if (status === "sent") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-700">{t("sentTitle")}</p>
        <p className="text-sm text-zinc-700">
          {t("sentBody", { email })}
        </p>
        {devMode && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t("devMode")}
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {status === "error" && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{t("error")}</p>
      )}
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-zinc-700">
          {t("email")}
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={status === "sending"}
        className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {status === "sending" ? "…" : t("submit")}
      </button>
    </form>
  );
}
