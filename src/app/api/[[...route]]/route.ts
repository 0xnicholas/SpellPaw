// Embedded Hono API (ADR-0010) mounted on the Next.js catch-all route.
import { getToken } from "next-auth/jwt";
import { createApiApp } from "@/server/http";
import { prisma } from "@/lib/db";

const app = createApiApp({
  prisma,
  getAccountId: async (c) => {
    // getToken only reads the cookie header — pass headers directly (no
    // NextRequest wrapping; Hono hands us a plain Request here).
    const token = await getToken({
      req: { headers: c.req.raw.headers } as never,
      secret: process.env.AUTH_SECRET,
    });
    return token?.sub ?? null;
  },
});

export const GET = (req: Request) => app.fetch(req);
export const POST = (req: Request) => app.fetch(req);
export const PATCH = (req: Request) => app.fetch(req);
export const DELETE = (req: Request) => app.fetch(req);
