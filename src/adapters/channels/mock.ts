// Mock adapter — used for unconfigured platforms in dev/test (M1) and as the
// stand-in for channels whose real adapters arrive in M2 (LinkedIn, Instagram).
// buildAuthUrl returns a URL that completes the flow in one hop, so the whole
// connect → callback journey works in dev without platform credentials.
// M6 (ADR-0013): simulatesInbound = true — the queue layer schedules a
// simulated comment 30–90s after each publish, driving the mock-first inbound
// pipeline (comment → Inbox → lifecycle).
import { randomBytes } from "node:crypto";
import type { ChannelAdapter, PublishResult, TokenSet } from "./types";

/** Simulated comment template pool — one entry picked per scheduled comment. */
const COMMENT_TEMPLATES: ReadonlyArray<{
  name: string;
  handle: string;
  content: string;
}> = [
  { name: "Alice Chen", handle: "alice_chen", content: "This is exactly what I was looking for — thanks!" },
  { name: "Bob Martinez", handle: "bobm", content: "Great take. Would love to see a follow-up on this." },
  { name: "Carol Wang", handle: "carolwang", content: "How does this work in practice? Asking for a friend 😄" },
  { name: "Dave Kim", handle: "davekim", content: "Solid write-up. Sharing this with my team." },
  { name: "Eve Novak", handle: "evenovak", content: "Bookmarking this — the last point is gold." },
];

/** Pick a deterministic-ish simulated commenter (seeded by the variant id). */
export function generateMockComment(seed: string): {
  name: string;
  handle: string;
  content: string;
} {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COMMENT_TEMPLATES[hash % COMMENT_TEMPLATES.length];
}

export class MockAdapter implements ChannelAdapter {
  readonly slug: string;
  /** Mock comments drive the inbound pipeline (ADR-0013). */
  readonly simulatesInbound = true;

  constructor(slug: string) {
    this.slug = slug;
  }

  buildAuthUrl(state: string, redirectUri: string): string {
    const code = `mock-${randomBytes(8).toString("hex")}`;
    return `${redirectUri}?code=${code}&state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(code: string): Promise<TokenSet> {
    return {
      accessToken: `mock-at:${code}`,
      refreshToken: null,
      expiresAt: new Date(Date.now() + 3600_000),
    };
  }

  async publish(_content: string, _tokens: TokenSet): Promise<PublishResult> {
    return { externalId: `mock:${this.slug}:${Date.now()}` };
  }
}
