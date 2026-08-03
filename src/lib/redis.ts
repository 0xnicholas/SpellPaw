// Shared Redis client (module-level lazy singleton). Short-link resolution
// cache (ADR-0009) uses this; the rate limiter and BullMQ keep their own
// connections by design (independent lifecycle).
import IORedis from "ioredis";

let client: IORedis | null = null;

export function getRedis(): IORedis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!client) client = new IORedis(url, { maxRetriesPerRequest: 1 });
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    const c = client;
    client = null;
    await c.quit().catch(() => {});
  }
}
