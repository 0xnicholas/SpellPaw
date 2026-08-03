// Mock adapter — used for unconfigured platforms in dev/test (M1) and as the
// stand-in for channels whose real adapters arrive in M2 (LinkedIn, Instagram).
// buildAuthUrl returns a URL that completes the flow in one hop, so the whole
// connect → callback journey works in dev without platform credentials.
import { randomBytes } from "node:crypto";
import type { ChannelAdapter, PublishResult, TokenSet } from "./types";

export class MockAdapter implements ChannelAdapter {
  readonly slug: string;

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
