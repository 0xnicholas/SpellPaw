// Dev-only: hands the login page the magic link that Auth.js printed to the
// server log (AUTH_EMAIL_DEV_MODE=true sends no real email). Hard-disabled
// in production — this endpoint must never exist in a deployed build.
import { isDevMagicLinkMode, devMagicLinks } from "@/lib/auth";

export async function GET(request: Request): Promise<Response> {
  if (!isDevMagicLinkMode()) {
    return new Response("Not found", { status: 404 });
  }
  const email = new URL(request.url).searchParams.get("email")?.toLowerCase();
  if (!email) return new Response("email required", { status: 400 });

  const entry = devMagicLinks().get(email);
  // Links are only fresh for 5 minutes (Auth.js tokens last 24h, but a stale
  // entry on the login page would be confusing).
  if (!entry || Date.now() - entry.ts > 5 * 60 * 1000) {
    return new Response(JSON.stringify({ link: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ link: entry.url }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
