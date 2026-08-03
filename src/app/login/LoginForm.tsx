"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export function LoginForm({ devMode }: { devMode: boolean }) {
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
        <p className="text-sm text-zinc-700">
          Check <span className="font-medium">{email}</span> for your sign-in link.
        </p>
        {devMode && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Dev mode is on — the magic link is printed to the server console
            (<code>pnpm dev</code>).
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-zinc-700">
          Email
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
        {status === "sending" ? "Sending…" : "Email me a magic link"}
      </button>
      {status === "error" && (
        <p className="text-sm text-red-600">Something went wrong — try again.</p>
      )}
    </form>
  );
}
