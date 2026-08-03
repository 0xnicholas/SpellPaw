// Locale detection + prefixing (spec §7). /api, /s (short links, ADR-0009) and
// static assets are excluded — short-link codes must never gain a locale
// segment, and API/auth routes handle their own auth.
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|s|_next|_vercel|.*\\..*).*)"],
};
