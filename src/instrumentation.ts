// Starts the BullMQ workers when the Node server boots (monolithic deploy —
// spec: queue embedded in the app process, not a separate service).
// Guarded so dev hot-reloads / parallel processes don't double-start.

declare global {
  var __spellpawWorkersStarted: boolean | undefined;
  // Module-level reference — keeps the worker set (and its Redis connections)
  // alive for the process lifetime; a GC'd Worker would drop its connections.
  // Graceful shutdown is handled by process exit.
  var __spellpawWorkers: { close: () => Promise<void> } | undefined;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (globalThis.__spellpawWorkersStarted) return;
  globalThis.__spellpawWorkersStarted = true;

  try {
    const [{ prisma }, { getAdapter }, { getEncryptionKey }, { createWorkers }] =
      await Promise.all([
        import("@/lib/db"),
        import("@/adapters/channels/registry"),
        import("@/lib/crypto"),
        import("@/server/queue"),
      ]);

    const adapters = {
      twitter: getAdapter("twitter"),
      linkedin: getAdapter("linkedin"),
      instagram: getAdapter("instagram"),
    };
    globalThis.__spellpawWorkers = createWorkers({
      prisma,
      adapters,
      encryptionKey: getEncryptionKey(),
      redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    });
    console.log("[queue] workers started", Object.keys(adapters).join(", "));
  } catch (err) {
    console.error("[queue] failed to start workers — publishing degraded", err);
  }
}
