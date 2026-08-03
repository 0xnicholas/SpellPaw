// Auth.js (v5) — email magic link only (ADR-0007).
// Dev: links print to the server console (AUTH_EMAIL_DEV_MODE=true).
// Prod: SMTP via SMTP_URL + SMTP_FROM.
import NextAuth from "next-auth";
import EmailProvider from "next-auth/providers/email";
import nodemailer from "nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma) as never, // @auth/prisma-adapter types target the legacy client
  providers: [
    EmailProvider({
      // Validation requires `server` to be present; dev mode never touches it
      // (sendVerificationRequest returns early when AUTH_EMAIL_DEV_MODE).
      server: process.env.SMTP_URL ?? { host: "dev.invalid", port: 25 },
      from: process.env.SMTP_FROM ?? "SpellPaw <noreply@spellpaw.app>",
      sendVerificationRequest: async ({ identifier, url, provider }) => {
        if (process.env.AUTH_EMAIL_DEV_MODE === "true") {
          console.log(`[auth] magic link for ${identifier}:\n${url}`);
          return;
        }
        if (!provider.server) {
          throw new Error(
            "SMTP_URL is not configured — set it (and AUTH_EMAIL_DEV_MODE=false) to send real emails",
          );
        }
        const transport = nodemailer.createTransport(provider.server);
        await transport.sendMail({
          to: identifier,
          from: provider.from,
          subject: "Sign in to SpellPaw",
          text: `Sign in to SpellPaw with this link:\n\n${url}\n\nIf you didn't request this, you can ignore this email.`,
        });
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    // Expose the Auth.js subject (email for the email provider) as session.user.id,
    // which becomes Workspace.accountId.
    session: ({ session, token }) => {
      if (session.user) session.user.id = token.sub ?? "";
      return session;
    },
  },
});
