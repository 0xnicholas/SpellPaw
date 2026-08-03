// Redis-backed fixed-window rate limiter (spec §6). Without a redisUrl the
// limiter is a no-op (dev/test default) so the API stays usable without infra.

import IORedis from "ioredis";

export interface RateLimiter {
  /** Returns true when the call is allowed, false when over the limit. */
  allow(key: string, limit: number, windowSec: number): Promise<boolean>;
}

export function createRateLimiter(redisUrl?: string): RateLimiter {
  if (!redisUrl) return { allow: async () => true };
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
  return {
    async allow(key, limit, windowSec) {
      try {
        const script = `
          local current = redis.call('INCR', KEYS[1])
          if current == 1 then
            redis.call('EXPIRE', KEYS[1], ARGV[1])
          end
          return current <= tonumber(ARGV[2]) and 1 or 0
        `;
        const res = await redis.eval(script, 1, key, String(windowSec), String(limit));
        return res === 1;
      } catch (err) {
        // Fail-open: a Redis hiccup must never take the API down (rate limits
        // are a guardrail, not a correctness invariant).
        console.error("[rate-limit] redis error, failing open", err);
        return true;
      }
    },
  };
}
