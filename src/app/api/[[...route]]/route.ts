// Embedded Hono API (ADR-0010) mounted on the Next.js catch-all route.
import { getToken } from "next-auth/jwt";
import { createApiApp } from "@/server/http";
import { prisma } from "@/lib/db";
import { createPublisher } from "@/server/queue";
import { getAdapter } from "@/adapters/channels/registry";
import { getEncryptionKey } from "@/lib/crypto";

const app = createApiApp({
  prisma,
  publisher: createPublisher({
    prisma,
    adapters: {
      twitter: getAdapter("twitter"),
      linkedin: getAdapter("linkedin"),
      instagram: getAdapter("instagram"),
    },
    encryptionKey: getEncryptionKey(),
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  }),
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
