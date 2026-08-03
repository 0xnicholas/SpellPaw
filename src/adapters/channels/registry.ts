// Adapter registry — slug → ChannelAdapter. Runtime TypeScript map (no DB),
// per implementation spec §1 "Adapter 注册: 运行时 TypeScript Map——不存 DB".
import { createTwitterAdapter } from "./twitter";
import { MockAdapter } from "./mock";
import type { ChannelAdapter } from "./types";

export function getAdapter(slug: string): ChannelAdapter {
  switch (slug) {
    case "twitter": {
      const clientId = process.env.TWITTER_CLIENT_ID;
      const clientSecret = process.env.TWITTER_CLIENT_SECRET;
      if (clientId && clientSecret) {
        return createTwitterAdapter({
          clientId,
          clientSecret,
          redirectUri: process.env.TWITTER_OAUTH_REDIRECT_URI ?? "",
        });
      }
      return new MockAdapter("twitter");
    }
    case "linkedin":
      return new MockAdapter("linkedin");
    case "instagram":
      return new MockAdapter("instagram");
    default:
      throw new Error(`no adapter registered for channel "${slug}"`);
  }
}
