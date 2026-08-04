"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ devMode }: { devMode: boolean }) {
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [devLink, setDevLink] = useState<string | null>(null);

  // Dev mode: no real email is sent — poll the dev-only endpoint for the
  // magic link that Auth.js printed to the server log, then show it inline.
  useEffect(() => {
    if (status !== "sent" || !devMode || !email || devLink) return;
    let cancelled = false;
    const poll = async () => {
      for (let i = 0; i < 10 && !cancelled; i++) {
        const res = await fetch(`/api/dev/magic-link?email=${encodeURIComponent(email)}`);
        if (res.ok) {
          const body = (await res.json()) as { link: string | null };
          if (body.link) {
            if (!cancelled) setDevLink(body.link);
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 600));
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [status, devMode, email, devLink]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    // callbackUrl: "/" — the link lands on the landing page, which bounces
    // signed-in users into the workspace. Keeping the login page as the
    // callback would dump the user back on the form after a successful sign-in.
    const res = await signIn("email", { email, redirect: false, callbackUrl: "/" });
    setStatus(res?.ok === false ? "error" : "sent");
  }

  if (status === "sent") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-700">{t("sentTitle")}</p>
        {devMode ? (
          <>
            {devLink ? (
              <Button asChild className="w-full">
                <a href={devLink}>{t("devLinkCta")}</a>
              </Button>
            ) : (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t("devMode")}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-zinc-700">{t("sentBody", { email })}</p>
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
        <Label htmlFor="email" className="mb-1 text-zinc-700">
          {t("email")}
        </Label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <Button
        type="submit"
        disabled={status === "sending"}
        className="w-full"
      >
        {status === "sending" ? "…" : t("submit")}
      </Button>
    </form>
  );
}
